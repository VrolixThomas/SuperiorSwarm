import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { CLI_PRESET_NAMES } from "../../../shared/cli-preset";
import { cleanupReviewWorkspace } from "../../ai-review/cleanup";
import { startPolling } from "../../ai-review/commit-poller";
import {
	cancelReview,
	getReviewDraft,
	getReviewDrafts,
	getSettings,
	queueFollowUpReview,
	queueReview,
} from "../../ai-review/orchestrator";
import { publishReview } from "../../ai-review/review-publisher";
import { ensureReviewWorkspace } from "../../ai-review/review-workspace";
import { getDb } from "../../db";
import * as schema from "../../db/schema";
import { removeWorktree } from "../../git/operations";
import { publicProcedure, router } from "../index";

export const aiReviewRouter = router({
	getSettings: publicProcedure.query(() => {
		return getSettings();
	}),

	updateSettings: publicProcedure
		.input(
			z.object({
				cliPreset: z.enum(CLI_PRESET_NAMES as readonly [string, ...string[]]).optional(),
				autoReviewEnabled: z.boolean().optional(),
				autoReReviewOnCommit: z.boolean().optional(),
				skipPermissions: z.boolean().optional(),
				customPrompt: z.string().nullable().optional(),
				maxConcurrentReviews: z.number().min(1).max(10).optional(),
				autoApproveResolutions: z.boolean().optional(),
				autoPublishResolutions: z.boolean().optional(),
				autoSolveEnabled: z.boolean().optional(),
				solveAutoResolveThreads: z.boolean().optional(),
				solvePrompt: z.string().nullable().optional(),
			})
		)
		.mutation(({ input }) => {
			const db = getDb();
			const now = new Date();
			const updates: Record<string, unknown> = { updatedAt: now };

			if (input.cliPreset !== undefined) updates.cliPreset = input.cliPreset;
			if (input.autoReviewEnabled !== undefined)
				updates.autoReviewEnabled = input.autoReviewEnabled ? 1 : 0;
			if (input.autoReReviewOnCommit !== undefined)
				updates.autoReReviewOnCommit = input.autoReReviewOnCommit ? 1 : 0;
			if (input.skipPermissions !== undefined)
				updates.skipPermissions = input.skipPermissions ? 1 : 0;
			if (input.customPrompt !== undefined) {
				const trimmed = input.customPrompt?.trim();
				updates.customPrompt = trimmed || null;
			}
			if (input.maxConcurrentReviews !== undefined)
				updates.maxConcurrentReviews = input.maxConcurrentReviews;
			if (input.autoApproveResolutions !== undefined)
				updates.autoApproveResolutions = input.autoApproveResolutions ? 1 : 0;
			if (input.autoPublishResolutions !== undefined)
				updates.autoPublishResolutions = input.autoPublishResolutions ? 1 : 0;
			if (input.autoSolveEnabled !== undefined)
				updates.autoSolveEnabled = input.autoSolveEnabled ? 1 : 0;
			if (input.solveAutoResolveThreads !== undefined)
				updates.solveAutoResolveThreads = input.solveAutoResolveThreads ? 1 : 0;
			if (input.solvePrompt !== undefined) {
				const trimmed = input.solvePrompt?.trim();
				updates.solvePrompt = trimmed || null;
			}

			db.update(schema.aiReviewSettings)
				.set(updates)
				.where(eq(schema.aiReviewSettings.id, "default"))
				.run();

			return getSettings();
		}),

	getReviewDrafts: publicProcedure.query(() => {
		return getReviewDrafts();
	}),

	getReviewDraft: publicProcedure.input(z.object({ draftId: z.string() })).query(({ input }) => {
		return getReviewDraft(input.draftId);
	}),

	getReviewChainHistory: publicProcedure
		.input(z.object({ reviewChainId: z.string() }))
		.query(({ input }) => {
			const db = getDb();
			const drafts = db
				.select()
				.from(schema.reviewDrafts)
				.where(eq(schema.reviewDrafts.reviewChainId, input.reviewChainId))
				.all()
				.sort((a, b) => a.roundNumber - b.roundNumber);

			if (drafts.length === 0) return [];

			// Batch-fetch all comments for this chain in one query
			const draftIds = drafts.map((d) => d.id);
			const allComments = db
				.select()
				.from(schema.draftComments)
				.where(inArray(schema.draftComments.reviewDraftId, draftIds))
				.all();

			// Group by draft ID
			const commentsByDraft = new Map<string, typeof allComments>();
			for (const c of allComments) {
				const list = commentsByDraft.get(c.reviewDraftId) ?? [];
				list.push(c);
				commentsByDraft.set(c.reviewDraftId, list);
			}

			return drafts.map((draft) => {
				const comments = commentsByDraft.get(draft.id) ?? [];
				return {
					id: draft.id,
					roundNumber: draft.roundNumber,
					status: draft.status,
					commentCount: comments.length,
					approvedCount: comments.filter((c) => c.status === "approved" || c.status === "submitted")
						.length,
					rejectedCount: comments.filter((c) => c.status === "rejected").length,
					createdAt: draft.createdAt.toISOString(),
				};
			});
		}),

	triggerReview: publicProcedure
		.input(
			z.object({
				provider: z.enum(["github", "bitbucket"]),
				identifier: z.string(),
				title: z.string(),
				author: z.string(),
				sourceBranch: z.string(),
				targetBranch: z.string(),
				repoPath: z.string(),
				projectId: z.string(),
			})
		)
		.mutation(async ({ input }) => {
			if (!input.repoPath) {
				throw new Error(
					"Cannot start review: this PR's repository is not tracked in SuperiorSwarm. " +
						"Add the repository as a project first."
				);
			}

			// 1. Get or create review workspace + worktree
			const wsResult = await ensureReviewWorkspace({
				projectId: input.projectId,
				prProvider: input.provider,
				prIdentifier: input.identifier,
				prTitle: input.title,
				sourceBranch: input.sourceBranch,
				targetBranch: input.targetBranch,
			});

			// 2. Pass workspace info to orchestrator
			return queueReview({
				prProvider: input.provider,
				prIdentifier: input.identifier,
				prTitle: input.title,
				prAuthor: input.author,
				sourceBranch: input.sourceBranch,
				targetBranch: input.targetBranch,
				workspaceId: wsResult.workspaceId,
				worktreePath: wsResult.worktreePath,
			});
		}),

	triggerFollowUp: publicProcedure
		.input(z.object({ reviewChainId: z.string() }))
		.mutation(async ({ input }) => {
			const db = getDb();

			// Find the latest draft in this chain to get PR info
			let chainDrafts = db
				.select()
				.from(schema.reviewDrafts)
				.where(eq(schema.reviewDrafts.reviewChainId, input.reviewChainId))
				.all();

			if (chainDrafts.length === 0) {
				// Pre-migration draft
				const draft = db
					.select()
					.from(schema.reviewDrafts)
					.where(eq(schema.reviewDrafts.id, input.reviewChainId))
					.get();
				if (draft) {
					chainDrafts = [draft];
				}
			}

			const latestDraft = chainDrafts.sort((a, b) => b.roundNumber - a.roundNumber)[0];
			if (!latestDraft) throw new Error(`No drafts found for chain ${input.reviewChainId}`);

			// Find the workspace for this PR
			const workspace = db
				.select()
				.from(schema.workspaces)
				.where(
					and(
						eq(schema.workspaces.prProvider, latestDraft.prProvider),
						eq(schema.workspaces.prIdentifier, latestDraft.prIdentifier),
						eq(schema.workspaces.type, "review")
					)
				)
				.get();

			if (!workspace) throw new Error("Review workspace not found for this PR");

			const project = db
				.select()
				.from(schema.projects)
				.where(eq(schema.projects.id, workspace.projectId))
				.get();
			if (!project) throw new Error("Project not found for review workspace");

			// Get worktree path and update to latest
			const worktree = workspace.worktreeId
				? db
						.select()
						.from(schema.worktrees)
						.where(eq(schema.worktrees.id, workspace.worktreeId))
						.get()
				: null;

			if (!worktree?.path) throw new Error("Worktree not found for review workspace");

			// Fetch latest changes
			const { execFileSync } = await import("node:child_process");
			try {
				execFileSync("git", ["fetch", "origin"], { cwd: worktree.path, stdio: "pipe" });
				execFileSync("git", ["reset", "--hard", `origin/${latestDraft.sourceBranch}`], {
					cwd: worktree.path,
					stdio: "pipe",
				});
			} catch (err) {
				console.error("[ai-review] Failed to update worktree, continuing with current state:", err);
			}

			return queueFollowUpReview({
				reviewChainId: input.reviewChainId,
				workspaceId: workspace.id,
				worktreePath: worktree.path,
			});
		}),

	updateDraftComment: publicProcedure
		.input(
			z.object({
				commentId: z.string(),
				status: z.enum(["approved", "rejected", "edited", "submitted", "user-pending", "error"]),
				userEdit: z.string().optional(),
			})
		)
		.mutation(({ input }) => {
			const db = getDb();
			const updates: Record<string, unknown> = { status: input.status };
			if (input.userEdit !== undefined) updates.userEdit = input.userEdit;

			db.update(schema.draftComments)
				.set(updates)
				.where(eq(schema.draftComments.id, input.commentId))
				.run();

			return { success: true };
		}),

	batchUpdateDraftComments: publicProcedure
		.input(
			z.object({
				commentIds: z.array(z.string()),
				status: z.enum(["approved", "rejected"]),
			})
		)
		.mutation(({ input }) => {
			const db = getDb();
			db.update(schema.draftComments)
				.set({ status: input.status })
				.where(inArray(schema.draftComments.id, input.commentIds))
				.run();
			return { success: true, count: input.commentIds.length };
		}),

	deleteDraftComment: publicProcedure
		.input(z.object({ commentId: z.string() }))
		.mutation(({ input }) => {
			const db = getDb();
			db.delete(schema.draftComments).where(eq(schema.draftComments.id, input.commentId)).run();
			return { success: true };
		}),

	addUserComment: publicProcedure
		.input(
			z.object({
				prIdentifier: z.string(),
				prTitle: z.string(),
				sourceBranch: z.string().optional(),
				targetBranch: z.string().optional(),
				filePath: z.string(),
				lineNumber: z.number().optional(),
				side: z.enum(["LEFT", "RIGHT"]).optional(),
				body: z.string(),
			})
		)
		.mutation(({ input }) => {
			const db = getDb();
			const now = new Date();

			// Find or create a review draft for this PR
			let draft = db
				.select()
				.from(schema.reviewDrafts)
				.where(eq(schema.reviewDrafts.prIdentifier, input.prIdentifier))
				.get();

			if (!draft) {
				const draftId = randomUUID();
				db.insert(schema.reviewDrafts)
					.values({
						id: draftId,
						prProvider: "github",
						prIdentifier: input.prIdentifier,
						prTitle: input.prTitle,
						prAuthor: "",
						sourceBranch: input.sourceBranch ?? "",
						targetBranch: input.targetBranch ?? "",
						status: "ready",
						createdAt: now,
						updatedAt: now,
					})
					.run();
				draft = db
					.select()
					.from(schema.reviewDrafts)
					.where(eq(schema.reviewDrafts.id, draftId))
					.get()!;
			}

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

			return { id, status: "user-pending" };
		}),

	submitReview: publicProcedure
		.input(
			z.object({
				draftId: z.string(),
				verdict: z.enum(["COMMENT", "APPROVE", "REQUEST_CHANGES"]).default("COMMENT"),
				body: z.string().optional(),
			})
		)
		.mutation(async ({ input }) => {
			// If user provided a body, update the draft's summary before publishing
			if (input.body?.trim()) {
				const db = getDb();
				db.update(schema.reviewDrafts)
					.set({ summaryMarkdown: input.body.trim(), updatedAt: new Date() })
					.where(eq(schema.reviewDrafts.id, input.draftId))
					.run();
			}
			const result = await publishReview(input.draftId, input.verdict);
			startPolling();
			return result;
		}),

	cancelReview: publicProcedure.input(z.object({ draftId: z.string() })).mutation(({ input }) => {
		cancelReview(input.draftId);
		return { success: true };
	}),

	dismissReview: publicProcedure
		.input(z.object({ workspaceId: z.string() }))
		.mutation(async ({ input }) => {
			await cleanupReviewWorkspace(input.workspaceId);
			return { success: true };
		}),

	/** Reject all pending (unreviewed) comments on a draft, keeping approved/edited/submitted ones + summary */
	dismissPendingComments: publicProcedure
		.input(z.object({ draftId: z.string() }))
		.mutation(({ input }) => {
			const db = getDb();
			db.update(schema.draftComments)
				.set({ status: "rejected" })
				.where(
					and(
						eq(schema.draftComments.reviewDraftId, input.draftId),
						eq(schema.draftComments.status, "pending")
					)
				)
				.run();
			return { success: true };
		}),

	markCommitSeen: publicProcedure
		.input(z.object({ prIdentifier: z.string(), commitSha: z.string() }))
		.mutation(({ input }) => {
			const db = getDb();
			const draft = db
				.select()
				.from(schema.reviewDrafts)
				.where(eq(schema.reviewDrafts.prIdentifier, input.prIdentifier))
				.all()
				.filter((d) => d.status !== "dismissed")
				.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

			if (draft) {
				db.update(schema.reviewDrafts)
					.set({ commitSha: input.commitSha, updatedAt: new Date() })
					.where(eq(schema.reviewDrafts.id, draft.id))
					.run();
			}
			return { success: true };
		}),
});
