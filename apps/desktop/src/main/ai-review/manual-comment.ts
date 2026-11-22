import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import * as schema from "../db/schema";
import { ReviewPathStorage } from "../review-path/storage";
import { parsePrIdentifier } from "./pr-identifier";

interface ManualCommentInput {
	prProvider: "github" | "bitbucket";
	prIdentifier: string;
	prTitle: string;
	sourceBranch?: string;
	targetBranch?: string;
	commitSha?: string;
	workspaceId?: string;
	reviewDraftId?: string;
	filePath: string;
	lineNumber?: number;
	side?: "LEFT" | "RIGHT";
	body: string;
}

const active = (draft: typeof schema.reviewDrafts.$inferSelect) =>
	["ready", "queued", "in_progress"].includes(draft.status);

/** Local draft writes use the workspace binding, never timestamp ties across review chains. */
export function addManualReviewComment(input: ManualCommentInput) {
	const db = getDb();
	return db.transaction(() => {
		const now = new Date();
		let draft: typeof schema.reviewDrafts.$inferSelect | undefined;
		let workspace: typeof schema.workspaces.$inferSelect | undefined;
		const matches = (candidate: typeof schema.reviewDrafts.$inferSelect) =>
			candidate.prProvider === input.prProvider &&
			candidate.prIdentifier === input.prIdentifier &&
			candidate.commitSha === (input.commitSha ?? null);

		if (input.workspaceId) {
			workspace = db
				.select()
				.from(schema.workspaces)
				.where(eq(schema.workspaces.id, input.workspaceId))
				.get();
			if (
				!workspace ||
				workspace.type !== "review" ||
				workspace.prProvider !== input.prProvider ||
				workspace.prIdentifier !== input.prIdentifier ||
				!input.commitSha
			)
				throw new Error("Manual comment does not match a registered review workspace and revision");
			const pr = parsePrIdentifier(input.prIdentifier);
			const identity = {
				workspaceId: workspace.id,
				provider: input.prProvider,
				owner: pr.owner,
				repo: pr.repo,
				prNumber: pr.number,
				headSha: input.commitSha,
			};
			const snapshot = new ReviewPathStorage(db).peek(identity);
			if (snapshot.identity.headSha !== input.commitSha)
				throw new Error("Review revision changed; refresh before commenting");
			const mapping = snapshot.runs
				.filter((run) => run.kind === "mapping" && run.identity.headSha === input.commitSha)
				.sort((a, b) => b.version - a.version)[0];
			if (mapping?.state === "running" && mapping.alsoReview !== false && !mapping.reviewDraftId)
				throw new Error("The review draft is initializing; retry the comment shortly");
			const bound = workspace.reviewDraftId
				? db
						.select()
						.from(schema.reviewDrafts)
						.where(eq(schema.reviewDrafts.id, workspace.reviewDraftId))
						.get()
				: undefined;
			if (bound && matches(bound) && active(bound)) draft = bound;
			if (input.reviewDraftId && (!bound || bound.id !== input.reviewDraftId || !matches(bound)))
				throw new Error("The active review draft changed; refresh before commenting");
		} else {
			if (input.reviewDraftId) throw new Error("An explicit review draft requires its workspace");
			const candidates = db
				.select()
				.from(schema.reviewDrafts)
				.where(
					and(
						eq(schema.reviewDrafts.prProvider, input.prProvider),
						eq(schema.reviewDrafts.prIdentifier, input.prIdentifier)
					)
				)
				.all()
				.filter((candidate) => matches(candidate) && active(candidate));
			if (candidates.length > 1)
				throw new Error(
					"Multiple review drafts exist; open the review workspace before commenting"
				);
			draft = candidates[0];
		}

		if (!draft) {
			const id = randomUUID();
			db.insert(schema.reviewDrafts)
				.values({
					id,
					prProvider: input.prProvider,
					prIdentifier: input.prIdentifier,
					prTitle: input.prTitle,
					prAuthor: "",
					sourceBranch: input.sourceBranch ?? "",
					targetBranch: input.targetBranch ?? "",
					status: "ready",
					commitSha: input.commitSha ?? null,
					createdAt: now,
					updatedAt: now,
				})
				.run();
			draft = db.select().from(schema.reviewDrafts).where(eq(schema.reviewDrafts.id, id)).get();
			if (!draft) throw new Error("Failed to create manual review draft");
		}
		if (workspace)
			db.update(schema.workspaces)
				.set({ reviewDraftId: draft.id, updatedAt: now })
				.where(eq(schema.workspaces.id, workspace.id))
				.run();
		const id = randomUUID();
		db.insert(schema.draftComments)
			.values({
				id,
				reviewDraftId: draft.id,
				filePath: input.filePath,
				lineNumber: input.lineNumber ?? null,
				side: input.side ?? null,
				body: input.body,
				status: "user-pending",
				createdAt: now,
			})
			.run();
		return { id, status: "user-pending", reviewDraftId: draft.id, commitSha: draft.commitSha };
	});
}
