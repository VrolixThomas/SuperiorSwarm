import { eq } from "drizzle-orm";
import simpleGit from "simple-git";
import { z } from "zod";
import { atlassianFetch } from "../../atlassian/auth";
import { getDb } from "../../db";
import { extensionPaths } from "../../db/schema";
import { readWorkingTreeFile, saveWorkingTreeFile } from "../../git/file-ops";
import { detectLanguage, parseUnifiedDiff } from "../../git/operations";
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
			const rawDiff = await git.diff([
				`${input.baseBranch}...${input.headBranch}`,
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
			try {
				const content = await git.show([`${input.ref}:${input.filePath}`]);
				return { content, language };
			} catch {
				return { content: "", language };
			}
		}),

	saveFileContent: publicProcedure
		.input(
			z.object({
				repoPath: z.string(),
				filePath: z.string(),
				content: z.string(),
			}),
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
});
