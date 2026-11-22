import { and, eq } from "drizzle-orm";
import { formatPrIdentifier } from "../../shared/pr-identifier";
import type {
	ReviewPathStatusProjection,
	ReviewPathStatusScope,
} from "../../shared/review-path-status";
import type { getDb } from "../db";
import { terminalSessions, workspaces } from "../db/schema";
import { reviewDrafts } from "../db/schema-ai-review";
import { ReviewPathStorage } from "./storage";

/** Read registered scope only: never create a workspace, observe a provider head, or mutate a run. */
export function readReviewPathStatus(
	db: ReturnType<typeof getDb>,
	scope: ReviewPathStatusScope
): ReviewPathStatusProjection | null {
	const prIdentifier = formatPrIdentifier({
		owner: scope.owner,
		repo: scope.repo,
		number: scope.prNumber,
	});
	const matches = db
		.select()
		.from(workspaces)
		.where(
			and(
				eq(workspaces.type, "review"),
				eq(workspaces.prProvider, scope.provider),
				eq(workspaces.prIdentifier, prIdentifier),
				scope.workspaceId ? eq(workspaces.id, scope.workspaceId) : undefined,
				scope.projectId ? eq(workspaces.projectId, scope.projectId) : undefined
			)
		)
		.all();
	// Multiple registrations are ambiguous without explicit workspace/project scope.
	if (matches.length !== 1) return null;
	const workspace = matches[0];
	if (!workspace) return null;
	const identity = {
		workspaceId: workspace.id,
		provider: scope.provider,
		owner: scope.owner,
		repo: scope.repo,
		prNumber: scope.prNumber,
		headSha: scope.headSha,
	};
	const snapshot = new ReviewPathStorage(db).peek(identity);
	const matchingHead = snapshot.identity.headSha === identity.headSha;
	const draft = workspace.reviewDraftId
		? db.select().from(reviewDrafts).where(eq(reviewDrafts.id, workspace.reviewDraftId)).get()
		: undefined;
	const reviewDraftId =
		draft?.prProvider === scope.provider &&
		draft.prIdentifier === prIdentifier &&
		draft.commitSha === scope.headSha
			? draft.id
			: undefined;
	const run = matchingHead
		? [...snapshot.runs]
				.filter(
					(run) =>
						run.identity.workspaceId === workspace.id &&
						run.identity.provider === scope.provider &&
						run.identity.owner === scope.owner &&
						run.identity.repo === scope.repo &&
						run.identity.prNumber === scope.prNumber &&
						run.identity.headSha === scope.headSha &&
						run.terminalId === `review-path:${run.id}:${run.version}`
				)
				.sort((a, b) => b.version - a.version)[0]
		: undefined;
	const session = run?.terminalId
		? db
				.select()
				.from(terminalSessions)
				.where(
					and(
						eq(terminalSessions.id, run.terminalId),
						eq(terminalSessions.workspaceId, workspace.id)
					)
				)
				.get()
		: undefined;
	return {
		identity,
		status: !matchingHead && snapshot.path ? "stale" : (snapshot.path?.status ?? "none"),
		reviewDraftId,
		terminal: session
			? {
					terminalId: session.id,
					reviewWorkspaceId: workspace.id,
					worktreePath: session.cwd,
				}
			: undefined,
	};
}
