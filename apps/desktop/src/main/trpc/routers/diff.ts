import { eq } from "drizzle-orm";
import simpleGit from "simple-git";
import { z } from "zod";
import { atlassianFetch } from "../../atlassian/auth";
import { getDb } from "../../db";
import { extensionPaths } from "../../db/schema";
import {
	createDirectory,
	deleteFile,
	readWorkingTreeFile,
	renameFile,
	saveWorkingTreeFile,
} from "../../git/file-ops";
import { listAllEntries, listDirectory } from "../../git/file-tree";
import {
	commitChanges,
	detectDefaultBranch,
	detectLanguage,
	getCommitsAhead,
	getCurrentBranch,
	getUntrackedFiles,
	listBranches,
	parseUnifiedDiff,
	stageFiles,
	unstageFiles,
} from "../../git/operations";
import { push } from "../../git/remote-ops";
import { publicProcedure, router } from "../index";

function computeStats(files: ReturnType<typeof parseUnifiedDiff>) {
	return {
		added: files.filter((f) => f.status === "added").length,
		removed: files.filter((f) => f.status === "deleted").length,
		changed: files.filter((f) => f.status !== "added" && f.status !== "deleted").length,
	};
}

export const diffRouter = router({
	getBranchDiff: publicProcedure
		.input(
			z.object({
				repoPath: z.string(),
				baseBranch: z.string(),
				headBranch: z.string(),
			})
		)
		.query(async ({ input }) => {
			const git = simpleGit(input.repoPath);
			const mergeBase = await git
				.raw(["merge-base", input.baseBranch, input.headBranch])
				.then((r) => r.trim())
				.catch(() => input.baseBranch);
			const rawDiff = await git.diff([
				`${mergeBase}..${input.headBranch}`,
				"--unified=3",
				"--no-color",
			]);
			const files = parseUnifiedDiff(rawDiff);
			return { files, stats: computeStats(files) };
		}),

	getWorkingTreeDiff: publicProcedure
		.input(z.object({ repoPath: z.string() }))
		.query(async ({ input }) => {
			const git = simpleGit(input.repoPath);
			// HEAD diff includes both staged and unstaged changes
			const rawDiff = await git.diff(["HEAD", "--unified=3", "--no-color"]);
			const files = parseUnifiedDiff(rawDiff);
			return { files, stats: computeStats(files) };
		}),

	getWorkingTreeStatus: publicProcedure
		.input(z.object({ repoPath: z.string() }))
		.query(async ({ input }) => {
			const git = simpleGit(input.repoPath);

			const [stagedRaw, unstagedRaw, untrackedPaths, branch] = await Promise.all([
				git.diff(["--cached", "--unified=3", "--no-color"]),
				git.diff(["--unified=3", "--no-color"]),
				getUntrackedFiles(input.repoPath),
				getCurrentBranch(input.repoPath),
			]);

			const stagedFiles = parseUnifiedDiff(stagedRaw);
			const unstagedFiles = parseUnifiedDiff(unstagedRaw);

			// Add untracked files as synthetic "added" entries
			for (const filePath of untrackedPaths) {
				unstagedFiles.push({
					path: filePath,
					status: "added",
					additions: 0,
					deletions: 0,
					hunks: [],
				});
			}

			return { stagedFiles, unstagedFiles, branch };
		}),

	stageFiles: publicProcedure
		.input(z.object({ repoPath: z.string(), paths: z.array(z.string()) }))
		.mutation(async ({ input }) => {
			await stageFiles(input.repoPath, input.paths);
		}),

	unstageFiles: publicProcedure
		.input(z.object({ repoPath: z.string(), paths: z.array(z.string()) }))
		.mutation(async ({ input }) => {
			await unstageFiles(input.repoPath, input.paths);
		}),

	commit: publicProcedure
		.input(z.object({ repoPath: z.string(), message: z.string().min(1) }))
		.mutation(async ({ input }) => {
			return await commitChanges(input.repoPath, input.message);
		}),

	push: publicProcedure.input(z.object({ repoPath: z.string() })).mutation(async ({ input }) => {
		await push(input.repoPath);
	}),

	getFileContent: publicProcedure
		.input(
			z.object({
				repoPath: z.string(),
				ref: z.string(),
				filePath: z.string(),
			})
		)
		.query(async ({ input }) => {
			const language = detectLanguage(input.filePath);
			// Empty ref means read from working tree (unstaged file on disk)
			if (input.ref === "") {
				const content = await readWorkingTreeFile(input.repoPath, input.filePath);
				return { content, language };
			}
			const git = simpleGit(input.repoPath);
			// Try the ref as-is first, then fall back to origin/<ref> for remote
			// tracking branches (GitHub returns bare branch names like "main"
			// but locally the branch may only exist as "origin/main").
			for (const ref of [input.ref, `origin/${input.ref}`]) {
				try {
					const content = await git.show([`${ref}:${input.filePath}`]);
					return { content, language };
				} catch {
					// try next ref variant
				}
			}
			return { content: "", language };
		}),

	saveFileContent: publicProcedure
		.input(
			z.object({
				repoPath: z.string(),
				filePath: z.string(),
				content: z.string(),
			})
		)
		.mutation(async ({ input }) => {
			await saveWorkingTreeFile(input.repoPath, input.filePath, input.content);
			return { ok: true };
		}),

	getPRDiff: publicProcedure
		.input(
			z.object({
				repoPath: z.string(),
				prId: z.number(),
				workspaceSlug: z.string(),
				repoSlug: z.string(),
			})
		)
		.query(async ({ input }) => {
			// Fetch raw unified diff from Bitbucket API
			const response = await atlassianFetch(
				"bitbucket",
				`https://api.bitbucket.org/2.0/repositories/${input.workspaceSlug}/${input.repoSlug}/pullrequests/${input.prId}/diff`
			);

			if (!response.ok) {
				throw new Error(`Bitbucket diff request failed: ${response.status}`);
			}

			const rawDiff = await response.text();
			const files = parseUnifiedDiff(rawDiff);

			// Also fetch PR metadata for the panel title
			const prResponse = await atlassianFetch(
				"bitbucket",
				`https://api.bitbucket.org/2.0/repositories/${input.workspaceSlug}/${input.repoSlug}/pullrequests/${input.prId}`
			);
			const prData = prResponse.ok
				? ((await prResponse.json()) as {
						title?: string;
						source?: { branch?: { name?: string } };
						destination?: { branch?: { name?: string } };
					})
				: null;

			return {
				files,
				stats: computeStats(files),
				pr: {
					title: prData?.title ?? `PR #${input.prId}`,
					sourceBranch: prData?.source?.branch?.name ?? "",
					targetBranch: prData?.destination?.branch?.name ?? "",
				},
			};
		}),

	listExtensions: publicProcedure.query(() => {
		const db = getDb();
		return db.select().from(extensionPaths).all();
	}),

	addExtension: publicProcedure.input(z.object({ path: z.string() })).mutation(({ input }) => {
		const db = getDb();
		const result = db.insert(extensionPaths).values({ path: input.path }).returning().get();
		return result;
	}),

	toggleExtension: publicProcedure
		.input(z.object({ id: z.number(), enabled: z.boolean() }))
		.mutation(({ input }) => {
			const db = getDb();
			db.update(extensionPaths)
				.set({ enabled: input.enabled })
				.where(eq(extensionPaths.id, input.id))
				.run();
			return { ok: true };
		}),

	listDirectory: publicProcedure
		.input(
			z.object({
				repoPath: z.string(),
				dirPath: z.string().optional(),
			})
		)
		.query(async ({ input }) => {
			const entries = await listDirectory(input.repoPath, input.dirPath);
			return { entries };
		}),

	getCommitsAhead: publicProcedure
		.input(z.object({ repoPath: z.string(), baseBranch: z.string() }))
		.query(async ({ input }) => {
			return await getCommitsAhead(input.repoPath, input.baseBranch);
		}),

	getDefaultBranch: publicProcedure
		.input(z.object({ repoPath: z.string() }))
		.query(async ({ input }) => {
			const branch = await detectDefaultBranch(input.repoPath);
			return { branch };
		}),

	listBranches: publicProcedure
		.input(z.object({ repoPath: z.string() }))
		.query(async ({ input }) => {
			const branches = await listBranches(input.repoPath);
			return { branches };
		}),

	listAllFiles: publicProcedure
		.input(z.object({ repoPath: z.string() }))
		.query(async ({ input }) => {
			const entries = await listAllEntries(input.repoPath);
			return { entries };
		}),

	revealInFinder: publicProcedure
		.input(z.object({ absolutePath: z.string() }))
		.mutation(async ({ input }) => {
			const { shell } = await import("electron");
			shell.showItemInFolder(input.absolutePath);
		}),

	createFile: publicProcedure
		.input(z.object({ repoPath: z.string(), filePath: z.string() }))
		.mutation(async ({ input }) => {
			await saveWorkingTreeFile(input.repoPath, input.filePath, "");
		}),

	createFolder: publicProcedure
		.input(z.object({ repoPath: z.string(), dirPath: z.string() }))
		.mutation(async ({ input }) => {
			await createDirectory(input.repoPath, input.dirPath);
		}),

	deleteFileOrFolder: publicProcedure
		.input(z.object({ repoPath: z.string(), targetPath: z.string() }))
		.mutation(async ({ input }) => {
			await deleteFile(input.repoPath, input.targetPath);
		}),

	renameFileOrFolder: publicProcedure
		.input(z.object({ repoPath: z.string(), oldPath: z.string(), newPath: z.string() }))
		.mutation(async ({ input }) => {
			await renameFile(input.repoPath, input.oldPath, input.newPath);
		}),
});
