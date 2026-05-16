import { dirname, join } from "node:path";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../../db";
import {
	githubBranchPrs,
	projects,
	sessionState,
	sharedFiles,
	workspaces,
	worktrees,
} from "../../db/schema";
import { checkoutBranchWorktree } from "../../git/operations";
import { symlinkSharedFiles } from "../../shared-files";
import { publicProcedure, router } from "../index";

function worktreeBasePath(repoPath: string): string {
	const parent = dirname(repoPath);
	const name = repoPath.split("/").pop() ?? "repo";
	return join(parent, `${name}-worktrees`);
}

export const workspacesRouter = router({
	getById: publicProcedure.input(z.object({ id: z.string() })).query(({ input }) => {
		const db = getDb();
		return (
			db
				.select({
					id: workspaces.id,
					projectId: workspaces.projectId,
					type: workspaces.type,
					name: workspaces.name,
					currentPhase: workspaces.currentPhase,
					statusText: workspaces.statusText,
					needs: workspaces.needs,
					isOrchestrator: workspaces.isOrchestrator,
					cliPreset: workspaces.cliPreset,
				})
				.from(workspaces)
				.where(eq(workspaces.id, input.id))
				.get() ?? null
		);
	}),

	listByProject: publicProcedure
		.input(z.object({ projectId: z.string() }))
		.query(async ({ input }) => {
			const { listByProjectTree } = await import("../../services/workspace-service");
			return listByProjectTree({ projectId: input.projectId });
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
			const { createWorkspace } = await import("../../services/workspace-service");
			const created = await createWorkspace({
				projectId: input.projectId,
				branch: input.branch,
				baseBranch: input.baseBranch,
			});

			const { getCachedPRs } = await import("../../ai-review/pr-poller");
			const matchingPR = getCachedPRs(input.projectId).find(
				(pr) => pr.sourceBranch === input.branch && pr.state === "open"
			);
			if (matchingPR) {
				const db = getDb();
				db.update(workspaces)
					.set({
						prProvider: matchingPR.provider,
						prIdentifier: matchingPR.identifier,
						updatedAt: new Date(),
					})
					.where(eq(workspaces.id, created.workspaceId))
					.run();
			}

			return {
				id: created.workspaceId,
				projectId: input.projectId,
				type: "worktree" as const,
				name: input.branch,
				worktreeId: created.worktreeId,
				terminalId: null as string | null,
				prProvider: matchingPR?.provider ?? null,
				prIdentifier: matchingPR?.identifier ?? null,
				createdAt: created.createdAt,
				updatedAt: created.updatedAt,
			};
		}),

	checkoutExisting: publicProcedure
		.input(
			z.object({
				projectId: z.string(),
				branch: z.string().min(1),
			})
		)
		.mutation(async ({ input }) => {
			const db = getDb();
			const project = db.select().from(projects).where(eq(projects.id, input.projectId)).get();

			if (!project) {
				throw new Error("Project not found");
			}

			const worktreePath = join(worktreeBasePath(project.repoPath), input.branch);

			await checkoutBranchWorktree(project.repoPath, worktreePath, input.branch);

			const now = new Date();
			const worktreeId = nanoid();
			const workspaceId = nanoid();

			db.insert(worktrees)
				.values({
					id: worktreeId,
					projectId: input.projectId,
					path: worktreePath,
					branch: input.branch,
					baseBranch: input.branch,
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
				prProvider: null as string | null,
				prIdentifier: null as string | null,
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

			// Auto-detect authored PR for this branch
			const { getCachedPRs } = await import("../../ai-review/pr-poller");
			const matchingPR = getCachedPRs(input.projectId).find(
				(pr) => pr.sourceBranch === input.branch && pr.state === "open"
			);
			if (matchingPR) {
				db.update(workspaces)
					.set({
						prProvider: matchingPR.provider,
						prIdentifier: matchingPR.identifier,
						updatedAt: new Date(),
					})
					.where(eq(workspaces.id, workspaceId))
					.run();
			}

			return {
				...workspace,
				prProvider: matchingPR?.provider ?? null,
				prIdentifier: matchingPR?.identifier ?? null,
			};
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
			const ws = db.select().from(workspaces).where(eq(workspaces.id, input.id)).get();
			if (!ws) throw new Error("Workspace not found");
			const { removeWorkspace } = await import("../../services/workspace-service");
			const result = await removeWorkspace({
				projectId: ws.projectId,
				workspaceId: input.id,
				force: input.force,
			});
			if (result.status === "blocked_uncommitted") {
				throw new Error("Worktree has uncommitted changes. Commit or discard them first.");
			}
		}),

	setOrchestrator: publicProcedure
		.input(z.object({ projectId: z.string().min(1), workspaceId: z.string().min(1) }))
		.mutation(async ({ input }) => {
			const { setOrchestrator } = await import("../../services/workspace-service");
			await setOrchestrator(
				{ projectId: input.projectId, workspaceId: input.workspaceId },
				{ workspaceId: input.workspaceId }
			);
			return { ok: true } as const;
		}),

	attachToOrchestrator: publicProcedure
		.input(z.object({ orchestratorId: z.string().min(1), workspaceId: z.string().min(1) }))
		.mutation(async ({ input }) => {
			const { attachToOrchestrator } = await import("../../services/orchestrator-membership");
			return attachToOrchestrator(input);
		}),

	detachFromOrchestrator: publicProcedure
		.input(z.object({ workspaceId: z.string().min(1) }))
		.mutation(async ({ input }) => {
			const { detachFromOrchestrator } = await import("../../services/orchestrator-membership");
			return detachFromOrchestrator(input);
		}),

	reorderTopLevel: publicProcedure
		.input(z.object({ projectId: z.string().min(1), orderedIds: z.array(z.string().min(1)) }))
		.mutation(async ({ input }) => {
			const { reorderTopLevel } = await import("../../services/workspace-ordering");
			return reorderTopLevel(input);
		}),

	reorderChildren: publicProcedure
		.input(z.object({ orchestratorId: z.string().min(1), orderedIds: z.array(z.string().min(1)) }))
		.mutation(async ({ input }) => {
			const { reorderChildren } = await import("../../services/workspace-ordering");
			return reorderChildren(input);
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
					// Worktree doesn't exist on disk — create it (blocking: we need the path)
					await checkoutBranchWorktree(project.repoPath, wtPath, input.sourceBranch);
				} else {
					// Worktree already exists on disk — fetch in background so the UI switch is instant
					const { default: simpleGit } = await import("simple-git");
					const git = simpleGit(wtPath);
					git
						.fetch("origin")
						.then(() => git.reset(["--hard", `origin/${input.sourceBranch}`]))
						.catch((err) => {
							console.error("[workspaces] Failed to update existing worktree, continuing:", err);
						});
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
				// Worktree exists — fetch in background so the UI switch is instant
				const worktree = db
					.select()
					.from(worktrees)
					.where(eq(worktrees.id, workspace.worktreeId))
					.get();
				if (worktree?.path) {
					const { default: simpleGit } = await import("simple-git");
					const git = simpleGit(worktree.path);
					git
						.fetch("origin")
						.then(() => git.reset(["--hard", `origin/${input.sourceBranch}`]))
						.catch((err) => {
							console.error("[workspaces] Failed to update existing worktree:", err);
						});
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

	getOrchestratorColors: publicProcedure
		.input(z.object({ projectId: z.string().min(1) }))
		.query(({ input }) => {
			const db = getDb();
			const key = `orchestratorColors:${input.projectId}`;
			const row = db.select().from(sessionState).where(eq(sessionState.key, key)).get();
			return row ? (JSON.parse(row.value) as Record<string, number>) : {};
		}),

	setOrchestratorColors: publicProcedure
		.input(
			z.object({
				projectId: z.string().min(1),
				map: z.record(z.string(), z.number().int().min(0).max(2)),
			})
		)
		.mutation(({ input }) => {
			const db = getDb();
			const key = `orchestratorColors:${input.projectId}`;
			const value = JSON.stringify(input.map);
			db.insert(sessionState)
				.values({ key, value })
				.onConflictDoUpdate({ target: sessionState.key, set: { value } })
				.run();
			return { ok: true } as const;
		}),

	getOrchestratorExpand: publicProcedure
		.input(z.object({ key: z.string().min(1) }))
		.query(({ input }) => {
			const db = getDb();
			const row = db.select().from(sessionState).where(eq(sessionState.key, input.key)).get();
			return row ? row.value === "1" : true;
		}),

	setOrchestratorExpand: publicProcedure
		.input(z.object({ key: z.string().min(1), value: z.boolean() }))
		.mutation(({ input }) => {
			const db = getDb();
			db.insert(sessionState)
				.values({ key: input.key, value: input.value ? "1" : "0" })
				.onConflictDoUpdate({ target: sessionState.key, set: { value: input.value ? "1" : "0" } })
				.run();
			return { ok: true } as const;
		}),
});
