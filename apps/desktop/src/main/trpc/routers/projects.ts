import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../../db";
import { projects, workspaces } from "../../db/schema";
import {
	cloneRepo,
	detectDefaultBranch,
	extractRepoName,
	getGitRoot,
	initRepo,
	parseRemoteUrl,
	validateGitUrl,
} from "../../git/operations";
import { BitbucketAdapter } from "../../providers/bitbucket-adapter";
import { GitHubAdapter } from "../../providers/github-adapter";
import { publicProcedure, router } from "../index";

const PROJECT_COLORS = [
	"#0a84ff",
	"#30d158",
	"#ff9f0a",
	"#ff375f",
	"#bf5af2",
	"#64d2ff",
	"#ffd60a",
	"#ff6482",
];

function randomColor(): string {
	return PROJECT_COLORS[Math.floor(Math.random() * PROJECT_COLORS.length)] ?? "#0a84ff";
}

function resolveTilde(p: string): string {
	if (p.startsWith("~/")) return join(homedir(), p.slice(2));
	if (p === "~") return homedir();
	return p;
}

function assertSafePath(baseDir: string, childName: string): string {
	if (/[/\\]/.test(childName)) {
		throw new Error("Name must not contain path separators");
	}
	const resolvedBase = resolve(baseDir);
	const resolvedTarget = resolve(baseDir, childName);
	if (!resolvedTarget.startsWith(resolvedBase + "/")) {
		throw new Error("Path escapes target directory");
	}
	return resolvedTarget;
}

const DEFAULT_PROJECTS_DIR = join(homedir(), "SuperiorSwarm", "projects");

// In-memory clone progress tracking
const cloneProgressMap = new Map<string, { stage: string; progress: number }>();

export const projectsRouter = router({
	list: publicProcedure.query(() => {
		const db = getDb();
		return db.select().from(projects).all();
	}),

	getByRepo: publicProcedure
		.input(z.object({ owner: z.string(), repo: z.string() }))
		.query(({ input }) => {
			const db = getDb();
			return db
				.select()
				.from(projects)
				.where(and(eq(projects.remoteOwner, input.owner), eq(projects.remoteRepo, input.repo)))
				.all();
		}),

	getPRDetails: publicProcedure
		.input(
			z.object({
				provider: z.enum(["github", "bitbucket"]),
				owner: z.string(),
				repo: z.string(),
				number: z.number(),
			})
		)
		.query(async ({ input }) => {
			const adapter = input.provider === "github" ? new GitHubAdapter() : new BitbucketAdapter();
			return adapter.getPRDetails(input.owner, input.repo, input.number);
		}),

	getById: publicProcedure.input(z.object({ id: z.string() })).query(({ input }) => {
		const db = getDb();
		const result = db.select().from(projects).where(eq(projects.id, input.id)).get();
		return result ?? null;
	}),

	clone: publicProcedure
		.input(
			z.object({
				url: z.string(),
				targetDir: z.string().optional(),
			})
		)
		.mutation(async ({ input }) => {
			if (!validateGitUrl(input.url)) {
				throw new Error("Invalid git URL");
			}

			const repoName = extractRepoName(input.url);
			const targetDir = resolveTilde(input.targetDir || DEFAULT_PROJECTS_DIR);
			const targetPath = assertSafePath(targetDir, repoName);

			if (existsSync(targetPath)) {
				throw new Error(`Directory already exists: ${targetPath}`);
			}

			const db = getDb();
			const now = new Date();
			const id = nanoid();

			const project = {
				id,
				name: repoName,
				repoPath: targetPath,
				defaultBranch: "main",
				color: randomColor(),
				remoteOwner: null as string | null,
				remoteRepo: null as string | null,
				remoteHost: null as string | null,
				status: "cloning" as const,
				createdAt: now,
				updatedAt: now,
			};

			db.insert(projects).values(project).run();

			// Background clone — don't await
			cloneRepo(input.url, targetPath, (progress) => {
				cloneProgressMap.set(id, {
					stage: progress.stage,
					progress: progress.progress,
				});
			})
				.then(async () => {
					const defaultBranch = await detectDefaultBranch(targetPath);
					const github = await parseRemoteUrl(targetPath);
					db.update(projects)
						.set({
							status: "ready",
							defaultBranch,
							remoteOwner: github?.owner ?? null,
							remoteRepo: github?.repo ?? null,
							remoteHost: github?.host ?? null,
							updatedAt: new Date(),
						})
						.where(eq(projects.id, id))
						.run();
					db.insert(workspaces)
						.values({
							id: nanoid(),
							projectId: id,
							type: "branch",
							name: defaultBranch,
							worktreeId: null,
							terminalId: null,
							createdAt: new Date(),
							updatedAt: new Date(),
						})
						.run();
					cloneProgressMap.delete(id);
				})
				.catch((err) => {
					console.error(`Clone failed for ${id}:`, err);
					try {
						db.update(projects)
							.set({ status: "error", updatedAt: new Date() })
							.where(eq(projects.id, id))
							.run();
					} catch (dbErr) {
						console.error(`Failed to update error status for ${id}:`, dbErr);
					}
					cloneProgressMap.delete(id);
				});

			return project;
		}),

	cloneProgress: publicProcedure.input(z.object({ id: z.string() })).query(({ input }) => {
		return cloneProgressMap.get(input.id) ?? null;
	}),

	openNew: publicProcedure.input(z.object({ path: z.string() })).mutation(async ({ input }) => {
		if (!isAbsolute(input.path)) {
			throw new Error("Path must be absolute");
		}
		const gitRoot = await getGitRoot(input.path);
		if (!gitRoot) {
			throw new Error("Not a git repository. Please initialize git first.");
		}

		const db = getDb();

		// Check if already tracked
		const existing = db.select().from(projects).where(eq(projects.repoPath, gitRoot)).get();
		if (existing) {
			return existing;
		}

		const defaultBranch = await detectDefaultBranch(gitRoot);
		const github = await parseRemoteUrl(gitRoot);
		const name = gitRoot.split("/").pop() ?? "unknown";
		const now = new Date();

		const project = {
			id: nanoid(),
			name,
			repoPath: gitRoot,
			defaultBranch,
			color: randomColor(),
			remoteOwner: github?.owner ?? null,
			remoteRepo: github?.repo ?? null,
			remoteHost: github?.host ?? null,
			status: "ready" as const,
			createdAt: now,
			updatedAt: now,
		};

		db.insert(projects).values(project).run();

		// Auto-create the branch workspace
		db.insert(workspaces)
			.values({
				id: nanoid(),
				projectId: project.id,
				type: "branch",
				name: defaultBranch,
				worktreeId: null,
				terminalId: null,
				createdAt: now,
				updatedAt: now,
			})
			.run();
		return project;
	}),

	createEmpty: publicProcedure
		.input(
			z.object({
				name: z.string().min(1),
				path: z.string().optional(),
			})
		)
		.mutation(async ({ input }) => {
			const targetDir = resolveTilde(input.path || DEFAULT_PROJECTS_DIR);
			const targetPath = assertSafePath(targetDir, input.name);

			if (existsSync(targetPath)) {
				throw new Error(`Directory already exists: ${targetPath}`);
			}

			await initRepo(targetPath, "main");

			const db = getDb();
			const now = new Date();

			const project = {
				id: nanoid(),
				name: input.name,
				repoPath: targetPath,
				defaultBranch: "main",
				color: randomColor(),
				remoteOwner: null as string | null,
				remoteRepo: null as string | null,
				remoteHost: null as string | null,
				status: "ready" as const,
				createdAt: now,
				updatedAt: now,
			};

			db.insert(projects).values(project).run();

			db.insert(workspaces)
				.values({
					id: nanoid(),
					projectId: project.id,
					type: "branch",
					name: "main",
					worktreeId: null,
					terminalId: null,
					createdAt: now,
					updatedAt: now,
				})
				.run();
			return project;
		}),

	update: publicProcedure
		.input(
			z.object({
				id: z.string(),
				name: z.string().optional(),
				color: z.string().optional(),
				defaultBranch: z.string().optional(),
			})
		)
		.mutation(({ input }) => {
			const db = getDb();
			const updates: Record<string, unknown> = {
				updatedAt: new Date(),
			};
			if (input.name !== undefined) updates["name"] = input.name;
			if (input.color !== undefined) updates["color"] = input.color;
			if (input.defaultBranch !== undefined) updates["defaultBranch"] = input.defaultBranch;

			db.update(projects).set(updates).where(eq(projects.id, input.id)).run();

			return db.select().from(projects).where(eq(projects.id, input.id)).get() ?? null;
		}),

	delete: publicProcedure.input(z.object({ id: z.string() })).mutation(({ input }) => {
		const db = getDb();
		db.delete(projects).where(eq(projects.id, input.id)).run();
	}),
});
