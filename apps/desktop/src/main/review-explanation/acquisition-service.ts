import { eq } from "drizzle-orm";
import { getWorkspaceCwdOrThrow } from "../agent-launch/workspace-cwd-lookup";
import { getValidToken } from "../atlassian/auth";
import { getBitbucketPRDetails } from "../atlassian/bitbucket";
import { getDb } from "../db";
import { workspaces } from "../db/schema";
import { githubFetch } from "../github/auth";
import { ReviewRevisionAcquisition } from "./revision-acquisition";

export const reviewRevisionAcquisition = new ReviewRevisionAcquisition({
	getAuthorization: async (remote, input) => {
		if (input.review?.provider !== "bitbucket" || !remote.startsWith("https://")) return undefined;
		const url = new URL(remote);
		if (url.hostname !== "bitbucket.org")
			throw new Error("Review Git remote does not match Bitbucket");
		const token = await getValidToken("bitbucket");
		if (!token) throw new Error("Review revision acquisition requires reconnecting Bitbucket");
		return `Authorization: Basic ${Buffer.from(`x-token-auth:${token}`).toString("base64")}`;
	},
	resolveRoot: async (input) => {
		const review = input.review;
		const ws = getDb().select().from(workspaces).where(eq(workspaces.id, input.workspaceId)).get();
		if (
			!review ||
			!ws ||
			ws.type !== "review" ||
			ws.prProvider !== review.provider ||
			ws.prIdentifier !== `${review.owner}/${review.repo}#${review.number}`
		)
			throw new Error("Review workspace/provider/PR identity mismatch");
		return getWorkspaceCwdOrThrow(input.workspaceId);
	},
	resolveSources: async (input) => {
		const review = input.review;
		if (!review) throw new Error("Review PR identity is required for acquisition");
		if (review.provider === "bitbucket") {
			const details = await getBitbucketPRDetails(review.owner, review.repo, review.number);
			return {
				headOid: details.headCommitOid,
				targetTipOid: details.baseCommitOid ?? "",
				headRepository: details.sourceRepoFullName,
				targetRepository: details.targetRepoFullName,
			};
		}
		const response = await githubFetch(
			`/repos/${encodeURIComponent(review.owner)}/${encodeURIComponent(review.repo)}/pulls/${review.number}`
		);
		if (!response.ok)
			throw new Error("Review PR revisions could not be verified before acquisition");
		const details = (await response.json()) as {
			head?: { sha?: string; repo?: { full_name?: string } | null };
			base?: { sha?: string; repo?: { full_name?: string } | null };
		};
		return {
			headOid: details.head?.sha ?? "",
			targetTipOid: details.base?.sha ?? "",
			headRepository: details.head?.repo?.full_name,
			targetRepository: details.base?.repo?.full_name,
		};
	},
});
