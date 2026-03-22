import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { cleanupReviewWorkspace } from "../../ai-review/cleanup";
import { startPolling } from "../../ai-review/commit-poller";
import {
	getReviewDraft,
	getReviewDrafts,
	getSettings,
	queueFollowUpReview,
	queueReview,
	validateTransition,
} from "../../ai-review/orchestrator";
import { publishReview } from "../../ai-review/review-publisher";
import { getDb } from "../../db";
import * as schema from "../../db/schema";
import { checkoutBranchWorktree, removeWorktree } from "../../git/operations";
import { publicProcedure, router } from "../index";

export const aiReviewRouter = router({
	getSettings: publicProcedure.query(() => {
		return getSettings();
	}),

	updateSettings: publicProcedure
		.input(
			z.object({
				cliPreset: z.enum(["claude", "gemini", "codex", "opencode"]).optional(),
				autoReviewEnabled: z.boolean().optional(),
				skipPermissions: z.boolean().optional(),
				customPrompt: z.string().nullable().optional(),
				maxConcurrentReviews: z.number().min(1).max(10).optional(),
				autoApproveResolutions: z.boolean().optional(),
				autoPublishResolutions: z.boolean().optional(),
			})
		)
		.mutation(({ input }) => {
			const db = getDb();
			const now = new Date();
			const updates: Record<string, unknown> = { updatedAt: now };

			if (input.cliPreset !== undefined) updates.cliPreset = input.cliPreset;
			if (input.autoReviewEnabled !== undefined)
				updates.autoReviewEnabled = input.autoReviewEnabled ? 1 : 0;
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
					"Cannot start review: this PR's repository is not tracked in BranchFlux. " +
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
			const { execSync } = await import("node:child_process");
			try {
				execSync("git fetch origin", { cwd: worktree.path, stdio: "pipe" });
				execSync(`git reset --hard origin/${latestDraft.sourceBranch}`, {
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

	deleteDraftComment: publicProcedure
		.input(z.object({ commentId: z.string() }))
		.mutation(({ input }) => {
			const db = getDb();
			db.delete(schema.draftComments)
				.where(eq(schema.draftComments.id, input.commentId))
				.run();
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
		.input(z.object({ draftId: z.string() }))
		.mutation(async ({ input }) => {
			const result = await publishReview(input.draftId);
			startPolling();
			return result;
		}),

	cancelReview: publicProcedure.input(z.object({ draftId: z.string() })).mutation(({ input }) => {
		const db = getDb();
		const draft = db
			.select({ status: schema.reviewDrafts.status })
			.from(schema.reviewDrafts)
			.where(eq(schema.reviewDrafts.id, input.draftId))
			.get();
		if (draft) {
			validateTransition(draft.status, "failed");
		}
		db.update(schema.reviewDrafts)
			.set({ status: "failed", updatedAt: new Date() })
			.where(eq(schema.reviewDrafts.id, input.draftId))
			.run();
		return { success: true };
	}),

	dismissReview: publicProcedure
		.input(z.object({ workspaceId: z.string() }))
		.mutation(async ({ input }) => {
			await cleanupReviewWorkspace(input.workspaceId);
			return { success: true };
		}),
});

/**
 * Get or create a review workspace + worktree for a PR.
 * This is the inline equivalent of workspacesRouter.getOrCreateReview
 * but called directly from the ai-review router to avoid cross-router calls.
 */
async function ensureReviewWorkspace(opts: {
	projectId: string;
	prProvider: string;
	prIdentifier: string;
	prTitle: string;
	sourceBranch: string;
	targetBranch: string;
}): Promise<{ workspaceId: string; worktreePath: string }> {
	const { dirname, join } = await import("node:path");
	const { nanoid } = await import("nanoid");
	const db = getDb();

	// 1. Check for existing review workspace
	let workspace = db
		.select()
		.from(schema.workspaces)
		.where(
			and(
				eq(schema.workspaces.projectId, opts.projectId),
				eq(schema.workspaces.prProvider, opts.prProvider),
				eq(schema.workspaces.prIdentifier, opts.prIdentifier)
			)
		)
		.get();

	// 2. Create if not exists
	if (!workspace) {
		const id = nanoid();
		const now = new Date();
		const name = `PR #${opts.prIdentifier.split("#")[1]}: ${opts.prTitle}`;
		db.insert(schema.workspaces)
			.values({
				id,
				projectId: opts.projectId,
				name,
				type: "review",
				prProvider: opts.prProvider,
				prIdentifier: opts.prIdentifier,
				createdAt: now,
				updatedAt: now,
			})
			.run();
		workspace = db.select().from(schema.workspaces).where(eq(schema.workspaces.id, id)).get()!;
	}

	// 3. Ensure worktree exists
	const project = db
		.select()
		.from(schema.projects)
		.where(eq(schema.projects.id, opts.projectId))
		.get();
	if (!project) throw new Error("Project not found");

	function worktreeBasePath(repoPath: string): string {
		const parent = dirname(repoPath);
		const name = repoPath.split("/").pop() ?? "repo";
		return join(parent, `${name}-worktrees`);
	}

	if (!workspace.worktreeId) {
		// Compute worktree path
		const sanitizedId = opts.prIdentifier.replace(/[^a-zA-Z0-9-]/g, "-");
		const wtPath = join(worktreeBasePath(project.repoPath), `pr-review-${sanitizedId}`);

		// Clean up stale worktree at same path if it exists
		const { existsSync, rmSync } = await import("node:fs");
		if (existsSync(wtPath)) {
			try {
				await removeWorktree(project.repoPath, wtPath);
			} catch {
				rmSync(wtPath, { recursive: true, force: true });
				const { execSync } = await import("node:child_process");
				try {
					execSync("git worktree prune", { cwd: project.repoPath, stdio: "pipe" });
				} catch {}
			}
		}

		await checkoutBranchWorktree(project.repoPath, wtPath, opts.sourceBranch);

		const now = new Date();
		const worktreeId = nanoid();
		db.insert(schema.worktrees)
			.values({
				id: worktreeId,
				projectId: opts.projectId,
				path: wtPath,
				branch: opts.sourceBranch,
				baseBranch: opts.targetBranch,
				createdAt: now,
				updatedAt: now,
			})
			.run();

		db.update(schema.workspaces)
			.set({ worktreeId, updatedAt: now })
			.where(eq(schema.workspaces.id, workspace.id))
			.run();

		return { workspaceId: workspace.id, worktreePath: wtPath };
	}

	// Worktree exists — update to latest
	const worktree = db
		.select()
		.from(schema.worktrees)
		.where(eq(schema.worktrees.id, workspace.worktreeId))
		.get();

	if (!worktree?.path) throw new Error("Worktree record not found");

	const { execSync } = await import("node:child_process");
	try {
		execSync("git fetch origin", { cwd: worktree.path, stdio: "pipe" });
		execSync(`git reset --hard origin/${opts.sourceBranch}`, {
			cwd: worktree.path,
			stdio: "pipe",
		});
	} catch (err) {
		console.error("[ai-review] Failed to update worktree, continuing with current state:", err);
	}

	return { workspaceId: workspace.id, worktreePath: worktree.path };
}
