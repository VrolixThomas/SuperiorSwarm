import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { eq } from "drizzle-orm";
import ignore from "ignore";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../../db";
import { projects, sharedFiles, worktrees } from "../../db/schema";
import { symlinkSharedFiles } from "../../shared-files";
import { buildSmartCandidateTree } from "../build-candidate-tree";
import { publicProcedure, router } from "../index";

/**
 * Recursively walk a directory and return all file paths relative to root.
 * Skips directories named node_modules and .git.
 */
function walkDir(dir: string, root: string): string[] {
	const results: string[] = [];
	let entries: ReturnType<typeof readdirSync>;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return results;
	}
	for (const entry of entries) {
		if (entry.name === "node_modules" || entry.name === ".git") continue;
		const fullPath = join(dir, entry.name);
		if (entry.isDirectory()) {
			results.push(...walkDir(fullPath, root));
		} else if (entry.isFile()) {
			results.push(relative(root, fullPath));
		}
	}
	return results;
}

export const sharedFilesRouter = router({
	list: publicProcedure.input(z.object({ projectId: z.string() })).query(({ input }) => {
		const db = getDb();
		return db.select().from(sharedFiles).where(eq(sharedFiles.projectId, input.projectId)).all();
	}),

	add: publicProcedure
		.input(z.object({ projectId: z.string(), relativePath: z.string().min(1) }))
		.mutation(({ input }) => {
			const db = getDb();
			const project = db.select().from(projects).where(eq(projects.id, input.projectId)).get();

			if (!project) throw new Error("Project not found");

			const fullPath = join(project.repoPath, input.relativePath);
			if (!existsSync(fullPath)) {
				throw new Error(`File not found: ${input.relativePath}`);
			}

			const id = nanoid();
			db.insert(sharedFiles)
				.values({
					id,
					projectId: input.projectId,
					relativePath: input.relativePath,
					createdAt: new Date(),
				})
				.run();

			return { id, relativePath: input.relativePath };
		}),

	remove: publicProcedure.input(z.object({ id: z.string() })).mutation(({ input }) => {
		const db = getDb();
		db.delete(sharedFiles).where(eq(sharedFiles.id, input.id)).run();
	}),

	addBatch: publicProcedure
		.input(z.object({ projectId: z.string(), relativePaths: z.array(z.string().min(1)).min(1) }))
		.mutation(({ input }) => {
			const db = getDb();
			const project = db.select().from(projects).where(eq(projects.id, input.projectId)).get();

			if (!project) throw new Error("Project not found");

			const added: Array<{ id: string; relativePath: string }> = [];
			const skipped: string[] = [];

			for (const relativePath of input.relativePaths) {
				const fullPath = join(project.repoPath, relativePath);
				if (!existsSync(fullPath)) {
					skipped.push(relativePath);
					continue;
				}

				const id = nanoid();
				db.insert(sharedFiles)
					.values({
						id,
						projectId: input.projectId,
						relativePath,
						createdAt: new Date(),
					})
					.run();
				added.push({ id, relativePath });
			}

			return { added, skipped };
		}),

	discoverCandidates: publicProcedure
		.input(z.object({ projectId: z.string() }))
		.query(({ input }) => {
			const db = getDb();
			const project = db.select().from(projects).where(eq(projects.id, input.projectId)).get();

			if (!project) throw new Error("Project not found");

			const gitignorePath = join(project.repoPath, ".gitignore");
			if (!existsSync(gitignorePath)) return [];

			const gitignoreContent = readFileSync(gitignorePath, "utf-8");
			const ig = ignore().add(gitignoreContent);

			const allFiles = walkDir(project.repoPath, project.repoPath);
			const ignoredFiles = allFiles.filter((f) => ig.ignores(f));

			const existing = db
				.select({ relativePath: sharedFiles.relativePath })
				.from(sharedFiles)
				.where(eq(sharedFiles.projectId, input.projectId))
				.all();
			const existingSet = new Set(existing.map((e) => e.relativePath));

			const filtered = ignoredFiles.filter((f) => !existingSet.has(f)).sort();
			return buildSmartCandidateTree(filtered, (p) => ig.ignores(p));
		}),

	sync: publicProcedure
		.input(z.object({ projectId: z.string(), worktreeId: z.string().optional() }))
		.mutation(async ({ input }) => {
			const db = getDb();
			const project = db.select().from(projects).where(eq(projects.id, input.projectId)).get();

			if (!project) throw new Error("Project not found");

			const entries = db
				.select()
				.from(sharedFiles)
				.where(eq(sharedFiles.projectId, input.projectId))
				.all();

			if (entries.length === 0) return { synced: 0, results: [] };

			const worktreeQuery = input.worktreeId
				? db.select().from(worktrees).where(eq(worktrees.id, input.worktreeId)).all()
				: db.select().from(worktrees).where(eq(worktrees.projectId, input.projectId)).all();

			const allResults: Array<{
				worktreePath: string;
				results: Awaited<ReturnType<typeof symlinkSharedFiles>>;
			}> = [];

			for (const wt of worktreeQuery) {
				const results = await symlinkSharedFiles(
					project.repoPath,
					wt.path,
					entries.map((e) => ({ relativePath: e.relativePath }))
				);
				allResults.push({ worktreePath: wt.path, results });
			}

			return { synced: worktreeQuery.length, results: allResults };
		}),
});
