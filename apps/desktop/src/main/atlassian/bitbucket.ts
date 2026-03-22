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
	commentCount: number;
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
	comment_count: number;
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
		commentCount: pr.comment_count ?? 0,
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

/** Fetch all comments on a Bitbucket pull request */
export async function getBitbucketPRComments(
	workspace: string,
	repoSlug: string,
	prId: number,
): Promise<
	Array<{
		id: number;
		author: string;
		body: string;
		filePath: string | null;
		lineNumber: number | null;
		createdAt: string;
		parentId: number | null;
	}>
> {
	const resp = await atlassianFetch(
		"bitbucket",
		`${BITBUCKET_API_BASE}/repositories/${workspace}/${repoSlug}/pullrequests/${prId}/comments?pagelen=100`,
	);
	if (!resp.ok) throw new Error(`Bitbucket comments fetch failed: ${resp.status}`);
	const data = (await resp.json()) as { values?: any[] };

	return (data.values ?? []).map((c: any) => ({
		id: c.id,
		author: c.user?.display_name ?? c.user?.nickname ?? "unknown",
		body: c.content?.raw ?? "",
		filePath: c.inline?.path ?? null,
		lineNumber: c.inline?.to ?? c.inline?.from ?? null,
		createdAt: c.created_on ?? "",
		parentId: c.parent?.id ?? null,
	}));
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
