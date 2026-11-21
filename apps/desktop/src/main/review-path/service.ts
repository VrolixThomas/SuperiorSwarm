import { eq } from "drizzle-orm";
import { formatPrIdentifier } from "../../shared/pr-identifier";
import type { ReviewPathIdentity, ReviewPathRuntimePort } from "../../shared/review-path-runtime";
import { getDb } from "../db";
import { workspaces } from "../db/schema";
import { getGitProvider } from "../providers/git-provider";
import { ReviewPathApplication } from "./application";
import { ReviewPathStorage } from "./storage";

let runtime: ReviewPathRuntimePort | undefined;
export function configureReviewPathRuntime(port: ReviewPathRuntimePort) {
	runtime = port;
}
export function getReviewPathStorage() {
	return new ReviewPathStorage(getDb());
}
export function validateReviewPathWorkspace(identity: ReviewPathIdentity) {
	const ws = getDb().select().from(workspaces).where(eq(workspaces.id, identity.workspaceId)).get();
	if (
		!ws ||
		ws.type !== "review" ||
		ws.prProvider !== identity.provider ||
		ws.prIdentifier !==
			formatPrIdentifier({ owner: identity.owner, repo: identity.repo, number: identity.prNumber })
	)
		throw new Error("Review workspace/provider/PR identity mismatch");
}
export function getReviewPathApplication() {
	return new ReviewPathApplication({
		storage: getReviewPathStorage(),
		runtime: () => {
			if (!runtime) throw new Error("Reading path runtime unavailable");
			return runtime;
		},
		validateWorkspace: validateReviewPathWorkspace,
		resolve: async (identity) => {
			validateReviewPathWorkspace(identity);
			const details = await getGitProvider(identity.provider).getPRDetails(
				identity.owner,
				identity.repo,
				identity.prNumber
			);
			if (!details.headCommitOid) throw new Error("PR head is unknown");
			return {
				identity: { ...identity, headSha: details.headCommitOid },
				changedFiles: details.files.map((file) => file.path),
			};
		},
	});
}
