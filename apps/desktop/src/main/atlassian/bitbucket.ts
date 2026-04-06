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
}

interface BitbucketApiPR {
	id: number;
	title: string;
	state: string;
	author: { display_name: string };
	source: { repository: { full_name: string }; branch?: { name?: string } };
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
	};
}

async function getBitbucketRepos(): Promise<Array<{ workspace: string; repoSlug: string }>> {
	const db = getDb();
	const allProjects = db.select().from(projects).all();
	const repos: Array<{ workspace: string; repoSlug: string }> = [];

	for (const project of allProjects) {
		const remote = await parseRemoteUrl(project.repoPath);
		if (remote && remote.host.includes("bitbucket")) {
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
		try {
			const url = `${BITBUCKET_API_BASE}/repositories/${workspace}/${repoSlug}/pullrequests?state=OPEN&pagelen=50&q=author.account_id%3D%22${auth.accountId}%22`;
			const res = await atlassianFetch("bitbucket", url);
			if (!res.ok) continue;

			const data = (await res.json()) as { values: BitbucketApiPR[] };
			for (const pr of data.values) {
				allPRs.push(mapPR(pr, workspace, repoSlug));
			}
		} catch (err) {
			console.error(`Failed to fetch PRs for ${workspace}/${repoSlug}:`, err);
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
		try {
			const url = `${BITBUCKET_API_BASE}/repositories/${workspace}/${repoSlug}/pullrequests?state=OPEN&pagelen=50&q=reviewers.account_id%3D%22${auth.accountId}%22`;
			const res = await atlassianFetch("bitbucket", url);
			if (!res.ok) continue;

			const data = (await res.json()) as { values: BitbucketApiPR[] };
			for (const pr of data.values) {
				allPRs.push(mapPR(pr, workspace, repoSlug));
			}
		} catch (err) {
			console.error(`Failed to fetch review PRs for ${workspace}/${repoSlug}:`, err);
		}
	}

	return allPRs;
}

/** Get the current state and head SHA of a Bitbucket pull request */
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
		source: { commit: { hash: string } };
		state: string;
	};
	return { headSha: data.source.commit.hash, state: data.state };
}

/** Post a comment on a Bitbucket pull request */
export async function createPRComment(
	workspace: string,
	repoSlug: string,
	prId: number,
	body: string,
	filePath?: string,
	line?: number
): Promise<{ id: number }> {
	const payload: Record<string, unknown> = {
		content: { raw: body },
	};

	if (filePath) {
		const inline: Record<string, unknown> = { path: filePath };
		if (line) {
			inline.to = line;
		}
		payload.inline = inline;
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
	id: number;
	body: string;
	author: string;
	filePath: string | null;
	lineNumber: number | null;
	createdAt: string;
}

/** Fetch all comments on a Bitbucket pull request (follows pagination) */
export async function getBitbucketPRComments(
	workspace: string,
	repoSlug: string,
	prId: number
): Promise<BitbucketComment[]> {
	const comments: BitbucketComment[] = [];
	let url: string | null =
		`${BITBUCKET_API_BASE}/repositories/${workspace}/${repoSlug}/pullrequests/${prId}/comments?pagelen=100`;

	while (url) {
		const res = await atlassianFetch("bitbucket", url);
		if (!res.ok) throw new Error(`Bitbucket get PR comments failed: ${res.status}`);
		const data = (await res.json()) as {
			values: Array<{
				id: number;
				content: { raw: string };
				author: { display_name: string };
				created_on: string;
				inline?: { path?: string; to?: number };
			}>;
			next?: string;
		};
		for (const c of data.values) {
			comments.push({
				id: c.id,
				body: c.content.raw,
				author: c.author.display_name,
				filePath: c.inline?.path ?? null,
				lineNumber: c.inline?.to ?? null,
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
		source?: { branch?: { name?: string } };
		destination?: { branch?: { name?: string } };
		participants?: Array<{
			user?: { display_name?: string } | null;
			role: string;
			state?: string | null;
		}>;
	};
	return {
		title: data.title ?? "",
		description: data.description ?? "",
		state: data.state ?? "OPEN",
		author: data.author?.display_name ?? "Unknown",
		authorAvatarUrl: data.author?.links?.avatar?.href ?? "",
		sourceBranch: data.source?.branch?.name ?? "",
		targetBranch: data.destination?.branch?.name ?? "",
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
