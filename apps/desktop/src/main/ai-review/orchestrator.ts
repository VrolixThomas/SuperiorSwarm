import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { and, eq, inArray, not } from "drizzle-orm";
import { app } from "electron";
import { nanoid } from "nanoid";
import { getDb } from "../db";
import * as schema from "../db/schema";
import { checkoutBranchWorktree } from "../git/operations";
import { getGitHubReviewThreads } from "../github/github";
import {
	CLI_PRESETS,
	type LaunchOptions,
	buildFollowUpPrompt,
	buildReviewPrompt,
	isCliInstalled,
} from "./cli-presets";

export interface ReviewLaunchInfo {
	draftId: string;
	reviewWorkspaceId: string;
	worktreePath: string;
	launchScript: string;
}

interface ActiveReview {
	draftId: string;
	reviewWorkspaceId: string;
	cleanup: (() => void) | null;
}

const activeReviews = new Map<string, ActiveReview>();

/** Clean up review artifacts for a completed/failed review */
function cleanupReview(draftId: string): void {
	// Run MCP config cleanup if tracked
	const active = activeReviews.get(draftId);
	if (active?.cleanup) {
		try {
			active.cleanup();
		} catch {}
	}
	activeReviews.delete(draftId);

	// Remove review directory from app data
	const reviewDir = join(app.getPath("userData"), "reviews", draftId);
	try {
		rmSync(reviewDir, { recursive: true, force: true });
	} catch {}
}

let pollInterval: ReturnType<typeof setInterval> | null = null;

function startPollingIfNeeded(): void {
	if (pollInterval || activeReviews.size === 0) return;

	pollInterval = setInterval(() => {
		if (activeReviews.size === 0) {
			clearInterval(pollInterval!);
			pollInterval = null;
			return;
		}

		const db = getDb();
		const draftIds = [...activeReviews.keys()];
		const drafts = db
			.select()
			.from(schema.reviewDrafts)
			.where(inArray(schema.reviewDrafts.id, draftIds))
			.all();

		for (const draft of drafts) {
			if (draft.status === "ready" || draft.status === "failed") {
				cleanupReview(draft.id);
			}
		}
	}, 10_000);
}

/** Get current AI review settings, creating defaults if needed */
export function getSettings(): schema.AiReviewSettings {
	const db = getDb();
	const existing = db
		.select()
		.from(schema.aiReviewSettings)
		.where(eq(schema.aiReviewSettings.id, "default"))
		.get();

	if (existing) return existing;

	// Insert defaults
	const now = new Date();
	db.insert(schema.aiReviewSettings)
		.values({
			id: "default",
			cliPreset: "claude",
			autoReviewEnabled: 0,
			skipPermissions: 1,
			maxConcurrentReviews: 3,
			updatedAt: now,
		})
		.run();

	return db
		.select()
		.from(schema.aiReviewSettings)
		.where(eq(schema.aiReviewSettings.id, "default"))
		.get()!;
}

/** Check if a PR already has a review draft (i.e., has been seen before) */
export function hasExistingReview(prIdentifier: string): boolean {
	const db = getDb();
	const existing = db
		.select()
		.from(schema.reviewDrafts)
		.where(eq(schema.reviewDrafts.prIdentifier, prIdentifier))
		.get();
	return !!existing;
}

/** Get the count of currently active (in_progress) reviews */
export function getActiveReviewCount(): number {
	return activeReviews.size;
}

/** Get all review drafts, optionally filtered by status */
export function getReviewDrafts(statuses?: string[]) {
	const db = getDb();
	if (statuses) {
		return db
			.select()
			.from(schema.reviewDrafts)
			.where(inArray(schema.reviewDrafts.status, statuses))
			.all();
	}
	return db
		.select()
		.from(schema.reviewDrafts)
		.where(not(eq(schema.reviewDrafts.status, "dismissed")))
		.all();
}

/** Get a single review draft with its comments */
export function getReviewDraft(draftId: string) {
	const db = getDb();
	const draft = db
		.select()
		.from(schema.reviewDrafts)
		.where(eq(schema.reviewDrafts.id, draftId))
		.get();

	if (!draft) return null;

	const comments = db
		.select()
		.from(schema.draftComments)
		.where(eq(schema.draftComments.reviewDraftId, draftId))
		.all();

	return { ...draft, comments };
}

/**
 * Ensure a worktree exists for a PR review. Returns the worktree path.
 * If one already exists (DB record + directory on disk), reuses it and fetches latest.
 * If not, creates a new one.
 */
export async function ensureReviewWorktree(opts: {
	projectId: string;
	repoPath: string;
	prProvider: string;
	prIdentifier: string;
	sourceBranch: string;
	targetBranch: string;
}): Promise<{ worktreePath: string; reviewWorkspaceId: string }> {
	const db = getDb();

	// Get or create review workspace
	let workspace = db
		.select()
		.from(schema.reviewWorkspaces)
		.where(
			and(
				eq(schema.reviewWorkspaces.projectId, opts.projectId),
				eq(schema.reviewWorkspaces.prProvider, opts.prProvider),
				eq(schema.reviewWorkspaces.prIdentifier, opts.prIdentifier)
			)
		)
		.get();

	if (!workspace) {
		const now = new Date();
		const id = nanoid();
		db.insert(schema.reviewWorkspaces)
			.values({
				id,
				projectId: opts.projectId,
				prProvider: opts.prProvider,
				prIdentifier: opts.prIdentifier,
				createdAt: now,
				updatedAt: now,
			})
			.run();
		workspace = db
			.select()
			.from(schema.reviewWorkspaces)
			.where(eq(schema.reviewWorkspaces.id, id))
			.get()!;
	}

	// Check if worktree already exists on disk
	const existingWorktree = workspace.worktreeId
		? db.select().from(schema.worktrees).where(eq(schema.worktrees.id, workspace.worktreeId)).get()
		: null;

	if (existingWorktree?.path && existsSync(existingWorktree.path)) {
		// Worktree exists — fetch latest
		const { execSync } = await import("node:child_process");
		try {
			execSync("git fetch origin", { cwd: existingWorktree.path, stdio: "pipe" });
			execSync(`git reset --hard origin/${opts.sourceBranch}`, {
				cwd: existingWorktree.path,
				stdio: "pipe",
			});
		} catch (err) {
			console.error("[ai-review] Failed to update worktree, continuing with current state:", err);
		}
		return { worktreePath: existingWorktree.path, reviewWorkspaceId: workspace.id };
	}

	// Worktree doesn't exist — create it
	const worktreeName = `pr-review-${opts.prIdentifier.replace(/[^a-zA-Z0-9]/g, "-")}`;
	const parentDir = join(dirname(opts.repoPath), `${opts.repoPath.split("/").pop()}-worktrees`);
	const worktreePath = join(parentDir, worktreeName);

	// Prune stale git worktree entries
	const { execSync } = await import("node:child_process");
	try {
		execSync("git worktree prune", { cwd: opts.repoPath, stdio: "pipe" });
	} catch {}

	// If directory exists on disk but isn't tracked in our DB, clean it up
	if (existsSync(worktreePath)) {
		try {
			execSync(`git worktree remove --force '${worktreePath}'`, {
				cwd: opts.repoPath,
				stdio: "pipe",
			});
		} catch {
			rmSync(worktreePath, { recursive: true, force: true });
			try {
				execSync("git worktree prune", { cwd: opts.repoPath, stdio: "pipe" });
			} catch {}
		}
	}

	await checkoutBranchWorktree(opts.repoPath, worktreePath, opts.sourceBranch);

	// Create worktree DB record
	const worktreeId = nanoid();
	const now = new Date();

	// Clean up any stale DB record at same path
	const staleWt = db
		.select()
		.from(schema.worktrees)
		.where(eq(schema.worktrees.path, worktreePath))
		.get();
	if (staleWt) {
		db.delete(schema.worktrees).where(eq(schema.worktrees.id, staleWt.id)).run();
	}

	db.insert(schema.worktrees)
		.values({
			id: worktreeId,
			projectId: opts.projectId,
			path: worktreePath,
			branch: opts.sourceBranch,
			baseBranch: opts.targetBranch,
			createdAt: now,
			updatedAt: now,
		})
		.run();

	// Link worktree to review workspace
	db.update(schema.reviewWorkspaces)
		.set({ worktreeId, updatedAt: now })
		.where(eq(schema.reviewWorkspaces.id, workspace.id))
		.run();

	return { worktreePath, reviewWorkspaceId: workspace.id };
}

/** Queue a new review for a PR. Returns launch info for the renderer to create the terminal. */
export async function queueReview(prData: {
	provider: "github" | "bitbucket";
	identifier: string;
	title: string;
	author: string;
	sourceBranch: string;
	targetBranch: string;
	repoPath: string;
	projectId: string;
}): Promise<ReviewLaunchInfo> {
	if (!prData.repoPath) {
		throw new Error(
			"Cannot start review: this PR's repository is not tracked in BranchFlux. " +
				"Add the repository as a project first."
		);
	}

	const db = getDb();
	const id = randomUUID();
	const now = new Date();

	db.insert(schema.reviewDrafts)
		.values({
			id,
			prProvider: prData.provider,
			prIdentifier: prData.identifier,
			prTitle: prData.title,
			prAuthor: prData.author,
			sourceBranch: prData.sourceBranch,
			targetBranch: prData.targetBranch,
			status: "queued",
			reviewChainId: id, // Chain starts with own ID
			roundNumber: 1,
			createdAt: now,
			updatedAt: now,
		})
		.run();

	return startReview(id, prData.repoPath, prData.projectId);
}

/**
 * Prepare a review — create worktree, workspace DB records, build CLI command.
 * Returns launch info so the renderer can create the terminal and run the command.
 */
async function startReview(
	draftId: string,
	repoPath: string,
	projectId: string
): Promise<ReviewLaunchInfo> {
	const db = getDb();
	const now = new Date();

	const draft = db
		.select()
		.from(schema.reviewDrafts)
		.where(eq(schema.reviewDrafts.id, draftId))
		.get();

	if (!draft) throw new Error(`Review draft ${draftId} not found`);

	// Mark as in_progress
	db.update(schema.reviewDrafts)
		.set({ status: "in_progress", updatedAt: now })
		.where(eq(schema.reviewDrafts.id, draft.id))
		.run();

	try {
		// Find the project for this repo
		const project = db
			.select()
			.from(schema.projects)
			.where(eq(schema.projects.repoPath, repoPath))
			.get();

		if (!project) {
			throw new Error("Cannot start review: repository not tracked as a project");
		}

		// Ensure worktree exists (creates if needed, reuses if already there)
		const { worktreePath, reviewWorkspaceId } = await ensureReviewWorktree({
			projectId,
			repoPath,
			prProvider: draft.prProvider,
			prIdentifier: draft.prIdentifier,
			sourceBranch: draft.sourceBranch,
			targetBranch: draft.targetBranch,
		});

		// Capture commit SHA
		const { execSync } = await import("node:child_process");
		const commitSha = execSync("git rev-parse HEAD", { cwd: worktreePath }).toString().trim();

		const dbPath = join(app.getPath("userData"), "branchflux.db");

		db.update(schema.reviewDrafts)
			.set({ commitSha, updatedAt: new Date() })
			.where(eq(schema.reviewDrafts.id, draft.id))
			.run();

		// Link draft to review workspace
		db.update(schema.reviewWorkspaces)
			.set({ reviewDraftId: draft.id, updatedAt: new Date() })
			.where(eq(schema.reviewWorkspaces.id, reviewWorkspaceId))
			.run();

		// Build MCP server path and launch options
		const settings = getSettings();
		const preset = CLI_PRESETS[settings.cliPreset];
		if (!preset) throw new Error(`Unknown CLI preset: ${settings.cliPreset}`);
		if (!isCliInstalled(preset.command)) {
			throw new Error(`CLI tool '${preset.command}' is not installed`);
		}

		const mcpServerPath = resolve(__dirname, "mcp-server.js");

		const prMetadata = {
			title: draft.prTitle,
			description: "",
			author: draft.prAuthor,
			sourceBranch: draft.sourceBranch,
			targetBranch: draft.targetBranch,
			reviewers: [],
			provider: draft.prProvider,
			prUrl: "",
		};

		// Write prompt and launch script to app data review directory
		const reviewDir = join(app.getPath("userData"), "reviews", draft.id);
		mkdirSync(reviewDir, { recursive: true });

		const promptFilePath = join(reviewDir, "review-prompt.txt");
		writeFileSync(
			promptFilePath,
			buildReviewPrompt({
				title: draft.prTitle,
				author: draft.prAuthor,
				sourceBranch: draft.sourceBranch,
				targetBranch: draft.targetBranch,
				provider: draft.prProvider,
				customPrompt: settings.customPrompt,
			}),
			"utf-8"
		);

		const launchOpts: LaunchOptions = {
			mcpServerPath,
			worktreePath,
			reviewDir,
			promptFilePath,
			dbPath,
			reviewDraftId: draft.id,
			prMetadata: JSON.stringify(prMetadata),
		};

		// Setup MCP config — for Claude this writes .mcp.json with env vars,
		// for others it writes their specific config files
		const cleanupMcp = preset.setupMcp?.(launchOpts) ?? null;
		activeReviews.set(draft.id, { draftId: draft.id, reviewWorkspaceId, cleanup: cleanupMcp });
		startPollingIfNeeded();

		// Build the CLI command args
		const args = preset.buildArgs(launchOpts);
		const parts = [preset.command];
		if (settings.skipPermissions && preset.permissionFlag) {
			parts.push(preset.permissionFlag);
		}
		parts.push(...args);
		const cliCommand = parts.join(" ");

		// Write a launch script that sets env vars (if not handled by MCP config) and runs the CLI
		const launchScript = join(reviewDir, "start-review.sh");
		const envLines = preset.setupMcp
			? []
			: [
					`export REVIEW_DRAFT_ID='${draft.id}'`,
					`export PR_METADATA='${launchOpts.prMetadata.replace(/'/g, "'\\''")}'`,
					`export DB_PATH='${dbPath}'`,
				];
		const scriptContent = ["#!/bin/bash", `cd '${worktreePath}'`, ...envLines, "", cliCommand].join(
			"\n"
		);
		writeFileSync(launchScript, scriptContent, "utf-8");
		chmodSync(launchScript, 0o755);

		return {
			draftId: draft.id,
			reviewWorkspaceId,
			worktreePath,
			launchScript,
		};
	} catch (err) {
		console.error(`[ai-review] startReview failed for ${draft.id}:`, err);
		db.update(schema.reviewDrafts)
			.set({ status: "failed", updatedAt: new Date() })
			.where(eq(schema.reviewDrafts.id, draft.id))
			.run();
		activeReviews.delete(draft.id);
		throw err;
	}
}

function parsePrIdentifier(identifier: string): {
	ownerOrWorkspace: string;
	repo: string;
	number: number;
} {
	const [ownerRepo, numStr] = identifier.split("#");
	const [ownerOrWorkspace, repo] = ownerRepo!.split("/");
	return {
		ownerOrWorkspace: ownerOrWorkspace!,
		repo: repo!,
		number: Number.parseInt(numStr!, 10),
	};
}

/** Queue a follow-up review for an existing review chain */
export async function queueFollowUpReview(reviewChainId: string): Promise<ReviewLaunchInfo> {
	const db = getDb();

	// Find the latest draft in this chain
	// Try finding by reviewChainId first, fall back to draft ID for pre-migration drafts
	let chainDrafts = db
		.select()
		.from(schema.reviewDrafts)
		.where(eq(schema.reviewDrafts.reviewChainId, reviewChainId))
		.all();

	if (chainDrafts.length === 0) {
		// Pre-migration draft: reviewChainId is null, the passed ID is the draft's own ID
		const draft = db
			.select()
			.from(schema.reviewDrafts)
			.where(eq(schema.reviewDrafts.id, reviewChainId))
			.get();
		if (draft) {
			// Backfill the chain ID
			db.update(schema.reviewDrafts)
				.set({ reviewChainId, roundNumber: 1, updatedAt: new Date() })
				.where(eq(schema.reviewDrafts.id, reviewChainId))
				.run();
			chainDrafts = [{ ...draft, reviewChainId, roundNumber: 1 }];
		}
	}

	const latestDraft = chainDrafts.sort((a, b) => b.roundNumber - a.roundNumber)[0];
	if (!latestDraft) throw new Error(`No drafts found for chain ${reviewChainId}`);

	// Find the review workspace
	const workspace = db
		.select()
		.from(schema.reviewWorkspaces)
		.where(
			and(
				eq(schema.reviewWorkspaces.prProvider, latestDraft.prProvider),
				eq(schema.reviewWorkspaces.prIdentifier, latestDraft.prIdentifier)
			)
		)
		.get();

	const project = workspace
		? db.select().from(schema.projects).where(eq(schema.projects.id, workspace.projectId)).get()
		: null;

	if (!project) throw new Error("Project not found for review workspace");

	// Ensure worktree exists (creates if needed, reuses if already there)
	const { worktreePath, reviewWorkspaceId } = await ensureReviewWorktree({
		projectId: project.id,
		repoPath: project.repoPath,
		prProvider: latestDraft.prProvider,
		prIdentifier: latestDraft.prIdentifier,
		sourceBranch: latestDraft.sourceBranch,
		targetBranch: latestDraft.targetBranch,
	});

	// Create follow-up draft
	const id = randomUUID();
	const now = new Date();

	db.insert(schema.reviewDrafts)
		.values({
			id,
			prProvider: latestDraft.prProvider,
			prIdentifier: latestDraft.prIdentifier,
			prTitle: latestDraft.prTitle,
			prAuthor: latestDraft.prAuthor,
			sourceBranch: latestDraft.sourceBranch,
			targetBranch: latestDraft.targetBranch,
			status: "queued",
			reviewChainId,
			roundNumber: latestDraft.roundNumber + 1,
			previousDraftId: latestDraft.id,
			createdAt: now,
			updatedAt: now,
		})
		.run();

	// Link draft to review workspace
	db.update(schema.reviewWorkspaces)
		.set({ reviewDraftId: id, updatedAt: now })
		.where(eq(schema.reviewWorkspaces.id, reviewWorkspaceId))
		.run();

	return startFollowUpReview(id, worktreePath, project.repoPath, reviewWorkspaceId);
}

async function startFollowUpReview(
	draftId: string,
	worktreePath: string,
	repoPath: string,
	reviewWorkspaceId: string
): Promise<ReviewLaunchInfo> {
	const db = getDb();
	const now = new Date();

	const draft = db
		.select()
		.from(schema.reviewDrafts)
		.where(eq(schema.reviewDrafts.id, draftId))
		.get();
	if (!draft) throw new Error(`Follow-up draft ${draftId} not found`);

	db.update(schema.reviewDrafts)
		.set({ status: "in_progress", updatedAt: now })
		.where(eq(schema.reviewDrafts.id, draftId))
		.run();

	try {
		// Worktree already updated by ensureReviewWorktree — just capture commit SHA
		const { execSync } = await import("node:child_process");
		const commitSha = execSync("git rev-parse HEAD", { cwd: worktreePath }).toString().trim();

		db.update(schema.reviewDrafts)
			.set({ commitSha, updatedAt: new Date() })
			.where(eq(schema.reviewDrafts.id, draftId))
			.run();

		// Get previous draft's comments
		const previousComments = draft.previousDraftId
			? db
					.select()
					.from(schema.draftComments)
					.where(eq(schema.draftComments.reviewDraftId, draft.previousDraftId))
					.all()
			: [];

		const previousDraft = draft.previousDraftId
			? db
					.select()
					.from(schema.reviewDrafts)
					.where(eq(schema.reviewDrafts.id, draft.previousDraftId))
					.get()
			: null;

		// Pre-fetch platform resolution status for GitHub
		if (
			previousComments.length > 0 &&
			previousComments.some((c) => c.platformCommentId) &&
			draft.prProvider === "github"
		) {
			try {
				const { ownerOrWorkspace, repo, number: prNumber } = parsePrIdentifier(draft.prIdentifier);
				const threads = await getGitHubReviewThreads(ownerOrWorkspace, repo, prNumber);
				for (const comment of previousComments) {
					if (!comment.platformCommentId) continue;
					const thread = threads.find((t) => t.nodeId === comment.platformCommentId);
					if (thread?.isResolved) {
						db.update(schema.draftComments)
							.set({ resolution: "resolved-on-platform" })
							.where(eq(schema.draftComments.id, comment.id))
							.run();
						// Update in-memory copy too
						comment.resolution = "resolved-on-platform";
					}
				}
			} catch (err) {
				console.error("[ai-review] Failed to pre-fetch platform resolution status:", err);
			}
		}

		// Build follow-up prompt
		const settings = getSettings();
		const preset = CLI_PRESETS[settings.cliPreset];
		if (!preset) throw new Error(`Unknown CLI preset: ${settings.cliPreset}`);

		const dbPath = join(app.getPath("userData"), "branchflux.db");
		const mcpServerPath = resolve(__dirname, "mcp-server.js");
		const reviewDir = join(app.getPath("userData"), "reviews", draftId);
		mkdirSync(reviewDir, { recursive: true });

		const promptFilePath = join(reviewDir, "review-prompt.txt");
		writeFileSync(
			promptFilePath,
			buildFollowUpPrompt({
				title: draft.prTitle,
				author: draft.prAuthor,
				sourceBranch: draft.sourceBranch,
				targetBranch: draft.targetBranch,
				provider: draft.prProvider,
				customPrompt: settings.customPrompt,
				roundNumber: draft.roundNumber,
				previousCommitSha: previousDraft?.commitSha ?? "unknown",
				currentCommitSha: commitSha,
				previousComments: previousComments.map((c) => ({
					id: c.id,
					filePath: c.filePath,
					lineNumber: c.lineNumber,
					body: c.body,
					platformStatus: (c.resolution === "resolved-on-platform"
						? "resolved-on-platform"
						: "open") as "open" | "resolved-on-platform",
				})),
			}),
			"utf-8"
		);

		const prMetadata = {
			title: draft.prTitle,
			description: "",
			author: draft.prAuthor,
			sourceBranch: draft.sourceBranch,
			targetBranch: draft.targetBranch,
			reviewers: [],
			provider: draft.prProvider,
			prUrl: "",
		};

		const launchOpts: LaunchOptions = {
			mcpServerPath,
			worktreePath,
			reviewDir,
			promptFilePath,
			dbPath,
			reviewDraftId: draftId,
			prMetadata: JSON.stringify(prMetadata),
		};

		const cleanupMcp = preset.setupMcp?.(launchOpts) ?? null;

		activeReviews.set(draftId, {
			draftId,
			reviewWorkspaceId,
			cleanup: cleanupMcp,
		});
		startPollingIfNeeded();

		const args = preset.buildArgs(launchOpts);
		const parts = [preset.command];
		if (settings.skipPermissions && preset.permissionFlag) {
			parts.push(preset.permissionFlag);
		}
		parts.push(...args);
		const cliCommand = parts.join(" ");

		const launchScript = join(reviewDir, "start-review.sh");
		const envLines = preset.setupMcp
			? []
			: [
					`export REVIEW_DRAFT_ID='${draftId}'`,
					`export PR_METADATA='${launchOpts.prMetadata.replace(/'/g, "'\\''")}'`,
					`export DB_PATH='${dbPath}'`,
				];
		const scriptContent = ["#!/bin/bash", `cd '${worktreePath}'`, ...envLines, "", cliCommand].join(
			"\n"
		);
		writeFileSync(launchScript, scriptContent, "utf-8");
		chmodSync(launchScript, 0o755);

		return {
			draftId,
			reviewWorkspaceId,
			worktreePath,
			launchScript,
		};
	} catch (err) {
		console.error(`[ai-review] startFollowUpReview failed for ${draftId}:`, err);
		db.update(schema.reviewDrafts)
			.set({ status: "failed", updatedAt: new Date() })
			.where(eq(schema.reviewDrafts.id, draftId))
			.run();
		activeReviews.delete(draftId);
		throw err;
	}
}

/** Clean up stale in_progress reviews from a previous session */
export function cleanupStaleReviews(): void {
	const db = getDb();
	const stale = db
		.select({
			draftId: schema.reviewDrafts.id,
			worktreePath: schema.worktrees.path,
		})
		.from(schema.reviewDrafts)
		.leftJoin(
			schema.reviewWorkspaces,
			eq(schema.reviewWorkspaces.reviewDraftId, schema.reviewDrafts.id)
		)
		.leftJoin(schema.worktrees, eq(schema.reviewWorkspaces.worktreeId, schema.worktrees.id))
		.where(eq(schema.reviewDrafts.status, "in_progress"))
		.all();

	for (const { draftId, worktreePath } of stale) {
		if (worktreePath) {
			const mcpPaths = [
				join(worktreePath, ".mcp.json"),
				join(worktreePath, ".codex", "config.json"),
				join(worktreePath, ".opencode", "config.json"),
			];
			for (const p of mcpPaths) {
				try {
					rmSync(p);
				} catch {}
			}
			for (const dir of [".codex", ".opencode"]) {
				try {
					rmSync(join(worktreePath, dir), { recursive: true });
				} catch {}
			}
		}

		const reviewDir = join(app.getPath("userData"), "reviews", draftId);
		try {
			rmSync(reviewDir, { recursive: true, force: true });
		} catch {}

		db.update(schema.reviewDrafts)
			.set({ status: "failed", updatedAt: new Date() })
			.where(eq(schema.reviewDrafts.id, draftId))
			.run();
	}

	if (stale.length > 0) {
		console.log(`[ai-review] Cleaned up ${stale.length} stale review(s)`);
	}
}
