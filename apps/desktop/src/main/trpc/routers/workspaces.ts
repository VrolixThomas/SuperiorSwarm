import { dirname, join } from "node:path";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../../db";
import { githubBranchPrs, projects, sharedFiles, terminalSessions, workspaces, worktrees } from "../../db/schema";
import { reviewDrafts } from "../../db/schema-ai-review";
import {
	checkoutBranchWorktree,
	createWorktree,
	hasUncommittedChanges,
	removeWorktree,
} from "../../git/operations";
import { symlinkSharedFiles } from "../../shared-files";
import { getDaemonClient } from "../../terminal/daemon-instance";
import { publicProcedure, router } from "../index";

function worktreeBasePath(repoPath: string): string {
	const parent = dirname(repoPath);
	const name = repoPath.split("/").pop() ?? "repo";
	return join(parent, `${name}-worktrees`);
}

export const workspacesRouter = router({
	listByProject: publicProcedure.input(z.object({ projectId: z.string() })).query(({ input }) => {
		const db = getDb();
		return db
			.select({
				id: workspaces.id,
				projectId: workspaces.projectId,
				type: workspaces.type,
				name: workspaces.name,
				worktreeId: workspaces.worktreeId,
				terminalId: workspaces.terminalId,
				prProvider: workspaces.prProvider,
				prIdentifier: workspaces.prIdentifier,
				reviewDraftId: workspaces.reviewDraftId,
				createdAt: workspaces.createdAt,
				updatedAt: workspaces.updatedAt,
				worktreePath: worktrees.path,
				draftStatus: reviewDrafts.status,
				draftCommitSha: reviewDrafts.commitSha,
			})
			.from(workspaces)
			.leftJoin(worktrees, eq(workspaces.worktreeId, worktrees.id))
			.leftJoin(reviewDrafts, eq(workspaces.reviewDraftId, reviewDrafts.id))
			.where(eq(workspaces.projectId, input.projectId))
			.all();
	}),

	create: publicProcedure
		.input(
			z.object({
				projectId: z.string(),
				branch: z.string().min(1),
				baseBranch: z.string().optional(),
			})
		)
		.mutation(async ({ input }) => {
			const db = getDb();
			const project = db.select().from(projects).where(eq(projects.id, input.projectId)).get();

			if (!project) {
				throw new Error("Project not found");
			}

			const baseBranch = input.baseBranch || project.defaultBranch;
			const worktreePath = join(worktreeBasePath(project.repoPath), input.branch);

			await createWorktree(project.repoPath, worktreePath, input.branch, baseBranch);

			const now = new Date();
			const worktreeId = nanoid();
			const workspaceId = nanoid();

			db.insert(worktrees)
				.values({
					id: worktreeId,
					projectId: input.projectId,
					path: worktreePath,
					branch: input.branch,
					baseBranch,
					createdAt: now,
					updatedAt: now,
				})
				.run();

			const workspace = {
				id: workspaceId,
				projectId: input.projectId,
				type: "worktree" as const,
				name: input.branch,
				worktreeId,
				terminalId: null as string | null,
				createdAt: now,
				updatedAt: now,
			};

			db.insert(workspaces).values(workspace).run();

			// Symlink shared files from main repo to new worktree
			const sharedEntries = db
				.select()
				.from(sharedFiles)
				.where(eq(sharedFiles.projectId, input.projectId))
				.all();

			if (sharedEntries.length > 0) {
				await symlinkSharedFiles(
					project.repoPath,
					worktreePath,
					sharedEntries.map((e) => ({ relativePath: e.relativePath }))
				);
			}

			return workspace;
		}),

	linkFromPR: publicProcedure
		.input(
			z.object({
				projectId: z.string(),
				prBranch: z.string().min(1),
				prOwner: z.string(),
				prRepo: z.string(),
				prNumber: z.number(),
			})
		)
		.mutation(async ({ input }) => {
			const db = getDb();
			const project = db.select().from(projects).where(eq(projects.id, input.projectId)).get();

			if (!project) {
				throw new Error("Project not found");
			}

			// Check if a workspace already exists for this branch in this project
			const existingWorktree = db
				.select({ worktreeId: worktrees.id })
				.from(worktrees)
				.where(and(eq(worktrees.projectId, input.projectId), eq(worktrees.branch, input.prBranch)))
				.get();

			let workspaceId: string;

			if (existingWorktree) {
				// Reuse existing workspace
				const existingWorkspace = db
					.select()
					.from(workspaces)
					.where(eq(workspaces.worktreeId, existingWorktree.worktreeId))
					.get();

				if (!existingWorkspace) {
					throw new Error("Workspace for existing worktree not found");
				}

				workspaceId = existingWorkspace.id;
			} else {
				// Create a new worktree for the existing remote branch
				const worktreePath = join(worktreeBasePath(project.repoPath), input.prBranch);
				await checkoutBranchWorktree(project.repoPath, worktreePath, input.prBranch);

				const now = new Date();
				const worktreeId = nanoid();
				workspaceId = nanoid();

				db.insert(worktrees)
					.values({
						id: worktreeId,
						projectId: input.projectId,
						path: worktreePath,
						branch: input.prBranch,
						baseBranch: project.defaultBranch,
						createdAt: now,
						updatedAt: now,
					})
					.run();

				db.insert(workspaces)
					.values({
						id: workspaceId,
						projectId: input.projectId,
						type: "worktree",
						name: input.prBranch,
						worktreeId,
						terminalId: null,
						createdAt: now,
						updatedAt: now,
					})
					.run();

				// Symlink shared files
				const sharedEntries = db
					.select()
					.from(sharedFiles)
					.where(eq(sharedFiles.projectId, input.projectId))
					.all();

				if (sharedEntries.length > 0) {
					await symlinkSharedFiles(
						project.repoPath,
						worktreePath,
						sharedEntries.map((e) => ({ relativePath: e.relativePath }))
					);
				}
			}

			// Link the PR to the workspace
			db.insert(githubBranchPrs)
				.values({
					id: nanoid(),
					workspaceId,
					prRepoOwner: input.prOwner,
					prRepoName: input.prRepo,
					prNumber: input.prNumber,
					createdAt: new Date(),
				})
				.onConflictDoNothing()
				.run();

			// Return the workspace with worktree path for navigation
			const workspace = db
				.select({
					id: workspaces.id,
					projectId: workspaces.projectId,
					type: workspaces.type,
					name: workspaces.name,
					worktreeId: workspaces.worktreeId,
					terminalId: workspaces.terminalId,
					createdAt: workspaces.createdAt,
					updatedAt: workspaces.updatedAt,
					worktreePath: worktrees.path,
				})
				.from(workspaces)
				.leftJoin(worktrees, eq(workspaces.worktreeId, worktrees.id))
				.where(eq(workspaces.id, workspaceId))
				.get();

			if (!workspace) {
				throw new Error("Failed to retrieve workspace after linking");
			}

			return workspace;
		}),

	delete: publicProcedure
		.input(z.object({ id: z.string(), force: z.boolean().optional() }))
		.mutation(async ({ input }) => {
			const db = getDb();
			const workspace = db.select().from(workspaces).where(eq(workspaces.id, input.id)).get();

			if (!workspace) {
				throw new Error("Workspace not found");
			}

			if (workspace.type === "branch") {
				throw new Error("Cannot delete the main branch workspace");
			}

			if (!workspace.worktreeId) {
				throw new Error("Workspace has no associated worktree");
			}

			const worktree = db
				.select()
				.from(worktrees)
				.where(eq(worktrees.id, workspace.worktreeId))
				.get();

			if (!worktree) {
				// Dispose daemon terminals before deleting workspace
				const wsSessions = db
					.select({ id: terminalSessions.id })
					.from(terminalSessions)
					.where(eq(terminalSessions.workspaceId, input.id))
					.all();
				const daemon = getDaemonClient();
				for (const session of wsSessions) {
					daemon?.dispose(session.id);
				}
				if (wsSessions.length > 0) {
					db.delete(terminalSessions)
						.where(eq(terminalSessions.workspaceId, input.id))
						.run();
				}
				// Worktree record missing — just clean up the workspace
				db.delete(workspaces).where(eq(workspaces.id, input.id)).run();
				return;
			}

			const { existsSync } = await import("node:fs");
			const pathExists = existsSync(worktree.path);

			if (pathExists && !input.force) {
				const dirty = await hasUncommittedChanges(worktree.path);
				if (dirty) {
					throw new Error("Worktree has uncommitted changes. Commit or discard them first.");
				}
			}

			const project = db.select().from(projects).where(eq(projects.id, workspace.projectId)).get();

			if (!project) {
				throw new Error("Project not found");
			}

			if (pathExists) {
				await removeWorktree(project.repoPath, worktree.path);
			}

			// Dispose daemon terminals before cascade deletes the workspace
			const wsSessions = db
				.select({ id: terminalSessions.id })
				.from(terminalSessions)
				.where(eq(terminalSessions.workspaceId, input.id))
				.all();
			const daemon = getDaemonClient();
			for (const session of wsSessions) {
				daemon?.dispose(session.id);
			}
			if (wsSessions.length > 0) {
				db.delete(terminalSessions)
					.where(eq(terminalSessions.workspaceId, input.id))
					.run();
			}

			db.delete(worktrees).where(eq(worktrees.id, worktree.id)).run();
		}),

	attachTerminal: publicProcedure
		.input(z.object({ workspaceId: z.string(), terminalId: z.string() }))
		.mutation(({ input }) => {
			const db = getDb();
			db.update(workspaces)
				.set({ terminalId: input.terminalId, updatedAt: new Date() })
				.where(eq(workspaces.id, input.workspaceId))
				.run();
		}),

	detachTerminal: publicProcedure
		.input(z.object({ workspaceId: z.string() }))
		.mutation(({ input }) => {
			const db = getDb();
			db.update(workspaces)
				.set({ terminalId: null, updatedAt: new Date() })
				.where(eq(workspaces.id, input.workspaceId))
				.run();
		}),

	getOrCreateReview: publicProcedure
		.input(
			z.object({
				projectId: z.string(),
				prProvider: z.enum(["github", "bitbucket"]),
				prIdentifier: z.string(),
				prTitle: z.string(),
				sourceBranch: z.string(),
				targetBranch: z.string(),
			})
		)
		.mutation(async ({ input }) => {
			const db = getDb();

			// 1. Check for existing review workspace
			let workspace = db
				.select()
				.from(workspaces)
				.where(
					and(
						eq(workspaces.projectId, input.projectId),
						eq(workspaces.prProvider, input.prProvider),
						eq(workspaces.prIdentifier, input.prIdentifier)
					)
				)
				.get();

			// 2. Create if not exists
			if (!workspace) {
				const id = nanoid();
				const now = new Date();
				const name = `PR #${input.prIdentifier.split("#")[1]}: ${input.prTitle}`;
				db.insert(workspaces)
					.values({
						id,
						projectId: input.projectId,
						name,
						type: "review",
						prProvider: input.prProvider,
						prIdentifier: input.prIdentifier,
						createdAt: now,
						updatedAt: now,
					})
					.run();
				workspace = db.select().from(workspaces).where(eq(workspaces.id, id)).get()!;
			}

			// 3. Ensure worktree exists
			const project = db.select().from(projects).where(eq(projects.id, input.projectId)).get();
			if (!project) throw new Error("Project not found");

			if (!workspace.worktreeId) {
				// Compute worktree path
				const sanitizedId = input.prIdentifier.replace(/[^a-zA-Z0-9-]/g, "-");
				const wtPath = join(worktreeBasePath(project.repoPath), `pr-review-${sanitizedId}`);

				const { existsSync } = await import("node:fs");
				if (!existsSync(wtPath)) {
					// Worktree doesn't exist on disk — create it
					await checkoutBranchWorktree(project.repoPath, wtPath, input.sourceBranch);
				} else {
					// Worktree already exists on disk — reuse it, just fetch latest
					const { default: simpleGit } = await import("simple-git");
					try {
						const git = simpleGit(wtPath);
						await git.fetch("origin");
						await git.reset(["--hard", `origin/${input.sourceBranch}`]);
					} catch (err) {
						console.error("[workspaces] Failed to update existing worktree, continuing:", err);
					}
				}

				const now = new Date();
				const worktreeId = nanoid();
				db.insert(worktrees)
					.values({
						id: worktreeId,
						projectId: input.projectId,
						path: wtPath,
						branch: input.sourceBranch,
						baseBranch: input.targetBranch,
						createdAt: now,
						updatedAt: now,
					})
					.run();

				db.update(workspaces)
					.set({ worktreeId, updatedAt: now })
					.where(eq(workspaces.id, workspace.id))
					.run();

				workspace = db.select().from(workspaces).where(eq(workspaces.id, workspace.id)).get()!;
			} else {
				// Worktree exists — update to latest
				const worktree = db
					.select()
					.from(worktrees)
					.where(eq(worktrees.id, workspace.worktreeId))
					.get();
				if (worktree?.path) {
					const { default: simpleGit } = await import("simple-git");
					const git = simpleGit(worktree.path);
					await git.fetch("origin");
					await git.reset(["--hard", `origin/${input.sourceBranch}`]);
				}
			}

			// 4. Return workspace with worktree path
			const worktree = workspace.worktreeId
				? db.select().from(worktrees).where(eq(worktrees.id, workspace.worktreeId)).get()
				: null;

			return { ...workspace, worktreePath: worktree?.path ?? null };
		}),

	cleanupReviewWorkspace: publicProcedure
		.input(z.object({ workspaceId: z.string() }))
		.mutation(async ({ input }) => {
			const { cleanupReviewWorkspace } = await import("../../ai-review/cleanup");
			await cleanupReviewWorkspace(input.workspaceId);
		}),
});
