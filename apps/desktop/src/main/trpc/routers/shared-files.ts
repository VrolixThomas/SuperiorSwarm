import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { eq } from "drizzle-orm";
import ignore from "ignore";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../../db";
import { projects, sharedFiles, worktrees } from "../../db/schema";
import { assertPathInsideRepo } from "../../path-utils";
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

			assertPathInsideRepo(project.repoPath, input.relativePath);

			const fullPath = join(project.repoPath, input.relativePath);
			if (!existsSync(fullPath)) {
				throw new Error(`Path not found: ${input.relativePath}`);
			}

			const stat = lstatSync(fullPath);
			const type = stat.isDirectory() ? "directory" : "file";

			const id = nanoid();
			db.insert(sharedFiles)
				.values({
					id,
					projectId: input.projectId,
					relativePath: input.relativePath,
					type,
					createdAt: new Date(),
				})
				.run();

			return { id, relativePath: input.relativePath, type };
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

			const added: Array<{ id: string; relativePath: string; type: "file" | "directory" }> = [];
			const skipped: string[] = [];

			for (const relativePath of input.relativePaths) {
				try {
					assertPathInsideRepo(project.repoPath, relativePath);
				} catch {
					skipped.push(relativePath);
					continue;
				}
				const fullPath = join(project.repoPath, relativePath);
				if (!existsSync(fullPath)) {
					skipped.push(relativePath);
					continue;
				}

				const stat = lstatSync(fullPath);
				const type = stat.isDirectory() ? "directory" : "file";

				const id = nanoid();
				db.insert(sharedFiles)
					.values({
						id,
						projectId: input.projectId,
						relativePath,
						type,
						createdAt: new Date(),
					})
					.run();
				added.push({ id, relativePath, type });
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
			// Test both `p` and `p/` because `.gitignore` often uses trailing-slash directory
			// patterns (e.g. `dist/`) where ig.ignores("dist") returns false but
			// ig.ignores("dist/") returns true.
			return buildSmartCandidateTree(filtered, (p) => ig.ignores(p) || ig.ignores(`${p}/`));
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
					entries.map((e) => ({ relativePath: e.relativePath, type: e.type as "file" | "directory" }))
				);
				allResults.push({ worktreePath: wt.path, results });
			}

			return { synced: worktreeQuery.length, results: allResults };
		}),
});
