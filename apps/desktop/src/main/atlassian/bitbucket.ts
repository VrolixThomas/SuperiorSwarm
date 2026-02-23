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
}

interface BitbucketApiPR {
	id: number;
	title: string;
	state: string;
	author: { display_name: string };
	source: { repository: { full_name: string } };
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
