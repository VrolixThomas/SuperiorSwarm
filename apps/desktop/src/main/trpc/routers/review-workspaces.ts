import { dirname, join } from "node:path";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../../db";
import { projects, reviewDrafts, reviewWorkspaces, worktrees } from "../../db/schema";
import {
	checkoutBranchWorktree,
	hasUncommittedChanges,
	removeWorktree,
} from "../../git/operations";
import { publicProcedure, router } from "../index";

function worktreeBasePath(repoPath: string): string {
	const parent = dirname(repoPath);
	const name = repoPath.split("/").pop() ?? "repo";
	return join(parent, `${name}-worktrees`);
}

export const reviewWorkspacesRouter = router({
	getOrCreate: publicProcedure
		.input(
			z.object({
				projectId: z.string(),
				prProvider: z.enum(["github", "bitbucket"]),
				prIdentifier: z.string(),
			})
		)
		.mutation(({ input }) => {
			const db = getDb();
			const existing = db
				.select()
				.from(reviewWorkspaces)
				.where(
					and(
						eq(reviewWorkspaces.projectId, input.projectId),
						eq(reviewWorkspaces.prProvider, input.prProvider),
						eq(reviewWorkspaces.prIdentifier, input.prIdentifier)
					)
				)
				.get();

			if (existing) {
				return existing;
			}

			const now = new Date();
			const newRecord = {
				id: nanoid(),
				projectId: input.projectId,
				prProvider: input.prProvider,
				prIdentifier: input.prIdentifier,
				reviewDraftId: null as string | null,
				worktreeId: null as string | null,
				terminalId: null as string | null,
				createdAt: now,
				updatedAt: now,
			};

			db.insert(reviewWorkspaces).values(newRecord).run();

			return newRecord;
		}),

	listByProject: publicProcedure.input(z.object({ projectId: z.string() })).query(({ input }) => {
		const db = getDb();
		return db
			.select({
				id: reviewWorkspaces.id,
				reviewDraftId: reviewWorkspaces.reviewDraftId,
				worktreeId: reviewWorkspaces.worktreeId,
				projectId: reviewWorkspaces.projectId,
				prProvider: reviewWorkspaces.prProvider,
				prIdentifier: reviewWorkspaces.prIdentifier,
				terminalId: reviewWorkspaces.terminalId,
				createdAt: reviewWorkspaces.createdAt,
				updatedAt: reviewWorkspaces.updatedAt,
				worktreePath: worktrees.path,
				draftStatus: reviewDrafts.status,
				draftCommitSha: reviewDrafts.commitSha,
			})
			.from(reviewWorkspaces)
			.leftJoin(worktrees, eq(reviewWorkspaces.worktreeId, worktrees.id))
			.leftJoin(reviewDrafts, eq(reviewWorkspaces.reviewDraftId, reviewDrafts.id))
			.where(eq(reviewWorkspaces.projectId, input.projectId))
			.all();
	}),

	listAll: publicProcedure.query(() => {
		const db = getDb();
		return db
			.select({
				id: reviewWorkspaces.id,
				reviewDraftId: reviewWorkspaces.reviewDraftId,
				worktreeId: reviewWorkspaces.worktreeId,
				projectId: reviewWorkspaces.projectId,
				prProvider: reviewWorkspaces.prProvider,
				prIdentifier: reviewWorkspaces.prIdentifier,
				terminalId: reviewWorkspaces.terminalId,
				createdAt: reviewWorkspaces.createdAt,
				updatedAt: reviewWorkspaces.updatedAt,
				worktreePath: worktrees.path,
				draftStatus: reviewDrafts.status,
				draftCommitSha: reviewDrafts.commitSha,
			})
			.from(reviewWorkspaces)
			.leftJoin(worktrees, eq(reviewWorkspaces.worktreeId, worktrees.id))
			.leftJoin(reviewDrafts, eq(reviewWorkspaces.reviewDraftId, reviewDrafts.id))
			.all();
	}),

	get: publicProcedure.input(z.object({ id: z.string() })).query(({ input }) => {
		const db = getDb();
		return db
			.select({
				id: reviewWorkspaces.id,
				reviewDraftId: reviewWorkspaces.reviewDraftId,
				worktreeId: reviewWorkspaces.worktreeId,
				projectId: reviewWorkspaces.projectId,
				prProvider: reviewWorkspaces.prProvider,
				prIdentifier: reviewWorkspaces.prIdentifier,
				terminalId: reviewWorkspaces.terminalId,
				createdAt: reviewWorkspaces.createdAt,
				updatedAt: reviewWorkspaces.updatedAt,
				worktreePath: worktrees.path,
				draftStatus: reviewDrafts.status,
				draftCommitSha: reviewDrafts.commitSha,
			})
			.from(reviewWorkspaces)
			.leftJoin(worktrees, eq(reviewWorkspaces.worktreeId, worktrees.id))
			.leftJoin(reviewDrafts, eq(reviewWorkspaces.reviewDraftId, reviewDrafts.id))
			.where(eq(reviewWorkspaces.id, input.id))
			.get();
	}),

	createWorktree: publicProcedure
		.input(
			z.object({
				reviewWorkspaceId: z.string(),
				sourceBranch: z.string(),
				targetBranch: z.string(),
			})
		)
		.mutation(async ({ input }) => {
			const db = getDb();
			const reviewWorkspace = db
				.select()
				.from(reviewWorkspaces)
				.where(eq(reviewWorkspaces.id, input.reviewWorkspaceId))
				.get();

			if (!reviewWorkspace) {
				throw new Error("Review workspace not found");
			}

			if (reviewWorkspace.worktreeId) {
				throw new Error("Review workspace already has a worktree");
			}

			const project = db
				.select()
				.from(projects)
				.where(eq(projects.id, reviewWorkspace.projectId))
				.get();

			if (!project) {
				throw new Error("Project not found");
			}

			const sanitizedIdentifier = reviewWorkspace.prIdentifier.replace(/[^a-zA-Z0-9-]/g, "-");
			const worktreePath = join(
				worktreeBasePath(project.repoPath),
				`pr-review-${sanitizedIdentifier}`
			);

			const { existsSync, rmSync } = await import("node:fs");

			if (existsSync(worktreePath)) {
				try {
					const { default: simpleGit } = await import("simple-git");
					const git = simpleGit(project.repoPath);
					await git.raw(["worktree", "remove", "--force", worktreePath]);
				} catch {
					rmSync(worktreePath, { recursive: true, force: true });
					try {
						const { default: simpleGit } = await import("simple-git");
						const git = simpleGit(project.repoPath);
						await git.raw(["worktree", "prune"]);
					} catch {
						// prune failure is non-fatal
					}
				}
			}

			await checkoutBranchWorktree(project.repoPath, worktreePath, input.sourceBranch);

			const now = new Date();
			const worktreeId = nanoid();

			db.insert(worktrees)
				.values({
					id: worktreeId,
					projectId: reviewWorkspace.projectId,
					path: worktreePath,
					branch: input.sourceBranch,
					baseBranch: input.targetBranch,
					createdAt: now,
					updatedAt: now,
				})
				.run();

			db.update(reviewWorkspaces)
				.set({ worktreeId, updatedAt: now })
				.where(eq(reviewWorkspaces.id, input.reviewWorkspaceId))
				.run();

			return { worktreeId, worktreePath };
		}),

	removeWorktree: publicProcedure
		.input(
			z.object({
				reviewWorkspaceId: z.string(),
				force: z.boolean().optional(),
			})
		)
		.mutation(async ({ input }) => {
			const db = getDb();
			const reviewWorkspace = db
				.select()
				.from(reviewWorkspaces)
				.where(eq(reviewWorkspaces.id, input.reviewWorkspaceId))
				.get();

			if (!reviewWorkspace) {
				throw new Error("Review workspace not found");
			}

			if (!reviewWorkspace.worktreeId) {
				return { success: true };
			}

			const worktree = db
				.select()
				.from(worktrees)
				.where(eq(worktrees.id, reviewWorkspace.worktreeId))
				.get();

			if (!worktree) {
				db.update(reviewWorkspaces)
					.set({ worktreeId: null, updatedAt: new Date() })
					.where(eq(reviewWorkspaces.id, input.reviewWorkspaceId))
					.run();
				return { success: true };
			}

			const project = db
				.select()
				.from(projects)
				.where(eq(projects.id, reviewWorkspace.projectId))
				.get();

			if (!project) {
				throw new Error("Project not found");
			}

			const { existsSync } = await import("node:fs");
			const pathExists = existsSync(worktree.path);

			if (pathExists && !input.force) {
				const dirty = await hasUncommittedChanges(worktree.path);
				if (dirty) {
					throw new Error("Worktree has uncommitted changes. Commit or discard them first.");
				}
			}

			if (pathExists) {
				await removeWorktree(project.repoPath, worktree.path);
			}

			db.delete(worktrees).where(eq(worktrees.id, worktree.id)).run();

			db.update(reviewWorkspaces)
				.set({ worktreeId: null, updatedAt: new Date() })
				.where(eq(reviewWorkspaces.id, input.reviewWorkspaceId))
				.run();

			return { success: true };
		}),

	attachTerminal: publicProcedure
		.input(z.object({ reviewWorkspaceId: z.string(), terminalId: z.string() }))
		.mutation(({ input }) => {
			const db = getDb();
			db.update(reviewWorkspaces)
				.set({ terminalId: input.terminalId, updatedAt: new Date() })
				.where(eq(reviewWorkspaces.id, input.reviewWorkspaceId))
				.run();
		}),
});
