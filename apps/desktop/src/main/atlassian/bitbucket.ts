import { getDb } from "../db";
import { projects } from "../db/schema";
import { parseRemoteUrl } from "../git/operations";
import { atlassianFetch, getAuth } from "./auth";
import { BITBUCKET_API_BASE } from "./constants";

export interface BitbucketPullRequest {
	id: number;
	title: string;
	state: string;
	author: string;
	repoSlug: string;
	workspace: string;
	webUrl: string;
	createdOn: string;
	updatedOn: string;
	source?: { branch?: { name: string } };
	destination?: { branch?: { name: string } };
	/** Head commit SHA from `source.commit.hash` in the listing response. */
	headCommitSha: string;
}

interface BitbucketApiPR {
	id: number;
	title: string;
	state: string;
	author: { display_name: string };
	source: {
		repository: { full_name: string };
		branch?: { name?: string };
		commit?: { hash?: string };
	};
	destination?: { branch?: { name?: string } };
	links: { html: { href: string } };
	created_on: string;
	updated_on: string;
}

function mapPR(pr: BitbucketApiPR, workspace: string, repoSlug: string): BitbucketPullRequest {
	return {
		id: pr.id,
		title: pr.title,
		state: pr.state,
		author: pr.author.display_name,
		repoSlug,
		workspace,
		webUrl: pr.links.html.href,
		createdOn: pr.created_on,
		updatedOn: pr.updated_on,
		source: pr.source.branch ? { branch: { name: pr.source.branch.name ?? "" } } : undefined,
		destination: pr.destination?.branch
			? { branch: { name: pr.destination.branch.name ?? "" } }
			: undefined,
		headCommitSha: pr.source.commit?.hash ?? "",
	};
}

/**
 * Walk a Bitbucket paginated listing endpoint until the `next` link is gone.
 *
 * The fetcher callback is the only impure part — pass it the URL of a page
 * and it returns the parsed body. The helper drives the loop, accumulates
 * `values`, and propagates errors up: if any page throws, the whole call
 * throws (Option X strict failure from the spec). The caller's per-provider
 * try/catch in `pr-poller.fetchAllPRs` then preserves all cached entries for
 * Bitbucket via the diffTrackedPrs partial-failure logic.
 */
export async function paginateBitbucket<T>(
	initialUrl: string,
	fetchPage: (url: string) => Promise<{ values: T[]; next?: string }>
): Promise<T[]> {
	const all: T[] = [];
	let url: string | null = initialUrl;
	while (url) {
		const page = await fetchPage(url);
		for (const v of page.values) all.push(v);
		url = page.next ?? null;
	}
	return all;
}

async function getBitbucketRepos(): Promise<Array<{ workspace: string; repoSlug: string }>> {
	const db = getDb();
	const allProjects = db.select().from(projects).all();
	const repos: Array<{ workspace: string; repoSlug: string }> = [];

	for (const project of allProjects) {
		const remote = await parseRemoteUrl(project.repoPath);
		if (remote?.host.includes("bitbucket")) {
			repos.push({ workspace: remote.owner, repoSlug: remote.repo });
		}
	}

	return repos;
}

export async function getMyPullRequests(): Promise<BitbucketPullRequest[]> {
	const auth = getAuth("bitbucket");
	if (!auth) return [];

	const repos = await getBitbucketRepos();
	if (repos.length === 0) return [];

	const allPRs: BitbucketPullRequest[] = [];

	for (const { workspace, repoSlug } of repos) {
		// NOTES:
		// 1. Bitbucket Cloud's `/pullrequests` listing endpoint caps `pagelen`
		//    at 50. Bumping this above 50 returns 400 Bad Request. Other
		//    Bitbucket endpoints (comments, statuses, diffstat) accept higher
		//    values, but this one does not — leave it at 50.
		// 2. State filter MUST be inside the `q=` BBQL expression, not a
		//    standalone `state=` parameter. When both are present, Bitbucket
		//    silently ignores the standalone `state=` and applies only `q=`,
		//    which means a query like `q=author.account_id="..."` returns
		//    PRs in EVERY state — including 1000s of merged/declined ones.
		//    See https://jira.atlassian.com/browse/BCLOUD-21305 for the
		//    quirk; the fix is to AND `state="OPEN"` into the q expression.
		const q = `state%3D%22OPEN%22%20AND%20author.account_id%3D%22${auth.accountId}%22`;
		const initialUrl = `${BITBUCKET_API_BASE}/repositories/${workspace}/${repoSlug}/pullrequests?pagelen=50&q=${q}`;
		const apiPrs = await paginateBitbucket<BitbucketApiPR>(initialUrl, async (url) => {
			const res = await atlassianFetch("bitbucket", url);
			if (!res.ok) {
				throw new Error(`Bitbucket pullrequests fetch failed: ${res.status} ${res.statusText}`);
			}
			return (await res.json()) as { values: BitbucketApiPR[]; next?: string };
		});
		for (const pr of apiPrs) {
			allPRs.push(mapPR(pr, workspace, repoSlug));
		}
	}

	return allPRs;
}

export async function getReviewRequests(): Promise<BitbucketPullRequest[]> {
	const auth = getAuth("bitbucket");
	if (!auth) return [];

	const repos = await getBitbucketRepos();
	if (repos.length === 0) return [];

	const allPRs: BitbucketPullRequest[] = [];

	for (const { workspace, repoSlug } of repos) {
		// See notes in getMyPullRequests above: pagelen capped at 50, AND state
		// must be baked into the `q=` expression or Bitbucket returns every state.
		const q = `state%3D%22OPEN%22%20AND%20reviewers.account_id%3D%22${auth.accountId}%22`;
		const initialUrl = `${BITBUCKET_API_BASE}/repositories/${workspace}/${repoSlug}/pullrequests?pagelen=50&q=${q}`;
		const apiPrs = await paginateBitbucket<BitbucketApiPR>(initialUrl, async (url) => {
			const res = await atlassianFetch("bitbucket", url);
			if (!res.ok) {
				throw new Error(`Bitbucket review requests fetch failed: ${res.status} ${res.statusText}`);
			}
			return (await res.json()) as { values: BitbucketApiPR[]; next?: string };
		});
		for (const pr of apiPrs) {
			allPRs.push(mapPR(pr, workspace, repoSlug));
		}
	}

	return allPRs;
}

interface BitbucketRevisionSide {
	branch?: { name?: string };
	commit?: { hash?: string };
	repository?: { full_name?: string } | null;
}

const FULL_COMMIT_OID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;

/** Expand the captured commit hash, never a branch that could have advanced. */
async function resolveCommitOid(
	workspace: string,
	repoSlug: string,
	side: BitbucketRevisionSide | undefined
): Promise<string | undefined> {
	const hash = side?.commit?.hash;
	if (typeof hash !== "string") return undefined;
	if (FULL_COMMIT_OID.test(hash)) return hash.toLowerCase();
	if (!/^[a-f0-9]{4,63}$/i.test(hash)) return undefined;
	// Fork heads belong to the source repository. Do not follow provider-supplied URLs.
	const fullName = side?.repository?.full_name;
	if (side?.repository && typeof fullName !== "string") return undefined;
	const parts = fullName === undefined ? [workspace, repoSlug] : fullName.split("/");
	if (parts.length !== 2 || parts.some((part) => !part || part === "." || part === ".."))
		return undefined;
	const repository = parts.map(encodeURIComponent).join("/");
	// https://developer.atlassian.com/cloud/bitbucket/rest/api-group-commits/#api-repositories-workspace-repo-slug-commit-commit-get
	const res = await atlassianFetch(
		"bitbucket",
		`${BITBUCKET_API_BASE}/repositories/${repository}/commit/${hash}`
	);
	if (!res.ok) return undefined;
	const data = (await res.json()) as { hash?: unknown };
	const resolved = data.hash;
	return typeof resolved === "string" &&
		FULL_COMMIT_OID.test(resolved) &&
		resolved.toLowerCase().startsWith(hash.toLowerCase())
		? resolved.toLowerCase()
		: undefined;
}

/** Get the current state and exact head SHA of a Bitbucket pull request. */
export async function getPRState(
	workspace: string,
	repoSlug: string,
	prId: number
): Promise<{ headSha: string; state: string }> {
	const res = await atlassianFetch(
		"bitbucket",
		`${BITBUCKET_API_BASE}/repositories/${workspace}/${repoSlug}/pullrequests/${prId}`
	);
	if (!res.ok) throw new Error(`Bitbucket get PR failed: ${res.status}`);
	const data = (await res.json()) as {
		source?: BitbucketRevisionSide;
		state: string;
	};
	const headSha = await resolveCommitOid(workspace, repoSlug, data.source);
	if (!headSha) throw new Error("Bitbucket PR revision unavailable");
	return { headSha, state: data.state };
}

/** Post a comment on a Bitbucket pull request */
export async function createPRComment(
	workspace: string,
	repoSlug: string,
	prId: number,
	body: string,
	filePath?: string,
	line?: number,
	side: "LEFT" | "RIGHT" = "RIGHT"
): Promise<{ id: number }> {
	const payload: Record<string, unknown> = {
		content: { raw: body },
	};

	if (filePath) {
		const inline: Record<string, unknown> = { path: filePath };
		if (line) {
			inline[side === "LEFT" ? "from" : "to"] = line;
		}
		payload["inline"] = inline;
	}

	const res = await atlassianFetch(
		"bitbucket",
		`${BITBUCKET_API_BASE}/repositories/${workspace}/${repoSlug}/pullrequests/${prId}/comments`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		}
	);
	if (!res.ok) throw new Error(`Bitbucket create comment failed: ${res.status}`);
	const data = (await res.json()) as { id: number };
	return { id: data.id };
}

/** Reply to an existing comment on a Bitbucket pull request */
export async function replyToPRComment(
	workspace: string,
	repoSlug: string,
	prId: number,
	parentCommentId: number,
	body: string
): Promise<{ id: number }> {
	const res = await atlassianFetch(
		"bitbucket",
		`${BITBUCKET_API_BASE}/repositories/${workspace}/${repoSlug}/pullrequests/${prId}/comments`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				content: { raw: body },
				parent: { id: parentCommentId },
			}),
		}
	);
	if (!res.ok) throw new Error(`Bitbucket reply comment failed: ${res.status}`);
	const data = (await res.json()) as { id: number };
	return { id: data.id };
}

/** Resolve or unresolve a comment on a Bitbucket pull request */
export async function resolvePRComment(
	workspace: string,
	repoSlug: string,
	prId: number,
	commentId: number,
	resolved: boolean
): Promise<void> {
	const res = await atlassianFetch(
		"bitbucket",
		`${BITBUCKET_API_BASE}/repositories/${workspace}/${repoSlug}/pullrequests/${prId}/comments/${commentId}`,
		{
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ resolved }),
		}
	);
	if (!res.ok) throw new Error(`Bitbucket resolve comment failed: ${res.status}`);
}

export interface BitbucketComment {
	parentId?: number | null;
	diffSide?: "LEFT" | "RIGHT" | null;
	isOutdated?: boolean;
	originalLine?: number | null;
	/** Absent when the provider did not supply a resolution object or explicit null. */
	isResolved?: boolean;
	authorId?: string | null;
	id: number;
	body: string;
	author: string;
	filePath: string | null;
	lineNumber: number | null;
	createdAt: string;
}

/**
 * Remove known Atlassian editor annotations outside Markdown code. Keep the
 * original text/whitespace elsewhere, including examples of these annotations.
 */
export function normalizeBitbucketDescription(description: string): string {
	const marker =
		/^\{[ \t]*:[ \t]*(?:data-layout[ \t]*=[ \t]*(?:"(?:center|wide|full-width)"|'(?:center|wide|full-width)')|data-inline-card[ \t]*=[ \t]*(?:""|''))[ \t]*\}/i;
	const legacyLine =
		/^[ \t]*\{[ \t]*data-layout[ \t]*=[ \t]*(['"])(?:center|wide|full-width)\1[ \t]*\}[ \t]*$/i;
	let fence: { character: string; length: number } | undefined;
	let inlineTicks = 0;
	const lines: string[] = [];
	for (const line of description.split("\n")) {
		// Container prefixes do not make quoted/list-nested code examples into prose.
		const containerLine = line.replace(/^(?: {0,3}>[ \t]?)+/, "");
		const fencedLine = containerLine.replace(/^ {0,3}(?:[-+*]|\d+[.)])[ \t]+/, "");
		const delimiter = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(fencedLine);
		if (fence) {
			if (
				delimiter?.[1]?.[0] === fence.character &&
				delimiter[1].length >= fence.length &&
				!delimiter[2]?.trim()
			)
				fence = undefined;
			lines.push(line);
			continue;
		}
		if (
			!inlineTicks &&
			delimiter?.[1] &&
			!(delimiter[1][0] === "`" && delimiter[2]?.includes("`"))
		) {
			fence = { character: delimiter[1][0] ?? "`", length: delimiter[1].length };
			lines.push(line);
			continue;
		}
		if (!inlineTicks && /^(?: {4}|\t)/.test(containerLine)) {
			lines.push(line);
			continue;
		}
		if (!inlineTicks && legacyLine.test(line)) continue;
		let output = "";
		let removed = false;
		for (let index = 0; index < line.length; ) {
			if (!inlineTicks && line[index] === "\\") {
				output += line.slice(index, index + 2);
				index += 2;
				continue;
			}
			if (line[index] === "`") {
				const start = index;
				while (line[index] === "`") index++;
				const length = index - start;
				if (!inlineTicks) inlineTicks = length;
				else if (inlineTicks === length) inlineTicks = 0;
				output += line.slice(start, index);
				continue;
			}
			const annotation =
				!inlineTicks && line[index] === "{" ? marker.exec(line.slice(index))?.[0] : undefined;
			if (annotation) {
				removed = true;
				index += annotation.length;
				if (/^[ \t]*$/.test(line.slice(index))) {
					output = output.replace(/[ \t]+$/, "");
					break;
				}
				if (!output || /[ \t]$/.test(output)) while (/[ \t]/.test(line[index] ?? "")) index++;
				continue;
			}
			output += line[index++];
		}
		if (!line.trim()) inlineTicks = 0;
		if (!removed || output.trim()) lines.push(output);
	}
	return lines.join("\n");
}

/** Fetch all comments on a Bitbucket pull request (follows pagination) */
export async function getBitbucketPRComments(
	workspace: string,
	repoSlug: string,
	prId: number
): Promise<BitbucketComment[]> {
	const comments: BitbucketComment[] = [];
	const pages = new Set<string>();
	const ids = new Set<number>();
	const repoUrl = new URL(`${BITBUCKET_API_BASE}/repositories/${workspace}/${repoSlug}/`);
	let url: string | null =
		`${BITBUCKET_API_BASE}/repositories/${workspace}/${repoSlug}/pullrequests/${prId}/comments?pagelen=100`;

	while (url) {
		const parsed = new URL(url);
		if (
			parsed.origin !== repoUrl.origin ||
			!parsed.pathname.startsWith(repoUrl.pathname) ||
			parsed.username ||
			parsed.password ||
			pages.has(parsed.href)
		) {
			throw new Error("Bitbucket comment pagination left the repository or repeated a page");
		}
		pages.add(parsed.href);
		const res = await atlassianFetch("bitbucket", url);
		if (!res.ok) throw new Error(`Bitbucket get PR comments failed: ${res.status}`);
		const data = (await res.json()) as {
			values: Array<{
				id: number;
				content?: { raw?: string } | null;
				deleted?: boolean;
				parent?: { id: number } | null;
				resolution?: object | null;
				user?: { display_name?: string; nickname?: string; uuid?: string } | null;
				created_on: string;
				inline?: {
					path?: string;
					to?: number | null;
					from?: number | null;
					outdated?: boolean;
				} | null;
			}>;
			next?: string;
		};
		if (
			!data ||
			!Array.isArray(data.values) ||
			(data.next != null && (typeof data.next !== "string" || !data.next)) ||
			(data.next && data.values.length === 0)
		)
			throw new Error("Bitbucket comment page is incomplete");
		for (const c of data.values) {
			if (!c || !Number.isSafeInteger(c.id) || ids.has(c.id)) {
				throw new Error("Bitbucket comment page contains an invalid or duplicate ID");
			}
			ids.add(c.id);
			const to =
				Number.isSafeInteger(c.inline?.to) && (c.inline?.to ?? 0) > 0 ? c.inline?.to : null;
			const from =
				Number.isSafeInteger(c.inline?.from) && (c.inline?.from ?? 0) > 0 ? c.inline?.from : null;
			const anchor = to ?? from ?? null;
			const isOutdated = typeof c.inline?.outdated === "boolean" ? c.inline.outdated : undefined;
			const isResolved =
				c.resolution === null
					? false
					: c.resolution && typeof c.resolution === "object" && !Array.isArray(c.resolution)
						? true
						: undefined;
			comments.push({
				id: c.id,
				body: c.deleted ? "[Deleted comment]" : (c.content?.raw ?? ""),
				author: c.user?.display_name ?? c.user?.nickname ?? "Unknown",
				authorId: c.user?.uuid || null,
				filePath: c.inline?.path ?? null,
				lineNumber: isOutdated ? null : anchor,
				diffSide: to != null ? "RIGHT" : from != null ? "LEFT" : null,
				isOutdated,
				originalLine: isOutdated ? anchor : undefined,
				isResolved,
				parentId: c.parent?.id ?? null,
				createdAt: c.created_on,
			});
		}
		url = data.next ?? null;
	}

	return comments;
}

export async function getBitbucketPRDetails(
	workspace: string,
	repoSlug: string,
	prId: number
): Promise<{
	title: string;
	description: string;
	state: string;
	author: string;
	authorAvatarUrl: string;
	sourceBranch: string;
	targetBranch: string;
	headCommitOid: string;
	baseCommitOid?: string;
	sourceRepoFullName?: string;
	targetRepoFullName?: string;
	participants: Array<{
		user?: { display_name?: string } | null;
		role: string;
		state?: string | null;
	}>;
}> {
	const res = await atlassianFetch(
		"bitbucket",
		`${BITBUCKET_API_BASE}/repositories/${workspace}/${repoSlug}/pullrequests/${prId}`
	);
	if (!res.ok) throw new Error(`Bitbucket PR fetch failed: ${res.status}`);
	const data = (await res.json()) as {
		title?: string;
		description?: string;
		state?: string;
		author?: { display_name?: string; links?: { avatar?: { href?: string } } } | null;
		source?: BitbucketRevisionSide;
		destination?: BitbucketRevisionSide;
		participants?: Array<{
			user?: { display_name?: string } | null;
			role: string;
			state?: string | null;
		}>;
	};
	// Both selectors came from this metadata response. The adapter rechecks the
	// expanded pair after loading mutable PR files before certifying its manifest.
	const [headCommitOid, baseCommitOid] = await Promise.all([
		resolveCommitOid(workspace, repoSlug, data.source),
		resolveCommitOid(workspace, repoSlug, data.destination),
	]);
	return {
		title: data.title ?? "",
		description: normalizeBitbucketDescription(data.description ?? ""),
		state: data.state ?? "OPEN",
		author: data.author?.display_name ?? "Unknown",
		authorAvatarUrl: data.author?.links?.avatar?.href ?? "",
		sourceBranch: data.source?.branch?.name ?? "",
		targetBranch: data.destination?.branch?.name ?? "",
		headCommitOid: headCommitOid ?? "",
		baseCommitOid,
		sourceRepoFullName: data.source?.repository?.full_name,
		targetRepoFullName: data.destination?.repository?.full_name,
		participants: data.participants ?? [],
	};
}

export async function getBitbucketPRStatuses(
	workspace: string,
	repoSlug: string,
	prId: number
): Promise<Array<{ state: string }>> {
	const res = await atlassianFetch(
		"bitbucket",
		`${BITBUCKET_API_BASE}/repositories/${workspace}/${repoSlug}/pullrequests/${prId}/statuses?pagelen=100`
	);
	if (!res.ok) return [];
	const data = (await res.json()) as { values?: Array<{ state: string }> };
	return data.values ?? [];
}
