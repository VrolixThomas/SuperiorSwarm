import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { eq, inArray } from "drizzle-orm";
import { app } from "electron";
import { nanoid } from "nanoid";
import { getDb } from "../db";
import * as schema from "../db/schema";
import { checkoutBranchWorktree } from "../git/operations";
import { CLI_PRESETS, type LaunchOptions, buildReviewPrompt, isCliInstalled } from "./cli-presets";

export interface ReviewLaunchInfo {
	draftId: string;
	workspaceId: string;
	worktreePath: string;
	launchScript: string; // absolute path to shell script that starts the review
}

interface ActiveReview {
	draftId: string;
	cleanup: (() => void) | null;
}

const activeReviews = new Map<string, ActiveReview>();

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
	return db.select().from(schema.reviewDrafts).all();
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

/** Queue a new review for a PR. Returns launch info for the renderer to create the terminal. */
export async function queueReview(prData: {
	provider: "github" | "bitbucket";
	identifier: string;
	title: string;
	author: string;
	sourceBranch: string;
	targetBranch: string;
	repoPath: string;
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
			createdAt: now,
			updatedAt: now,
		})
		.run();

	return startReview(id, prData.repoPath);
}

/**
 * Prepare a review — create worktree, workspace DB records, build CLI command.
 * Returns launch info so the renderer can create the terminal and run the command.
 */
async function startReview(draftId: string, repoPath: string): Promise<ReviewLaunchInfo> {
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

		// Create worktree for the PR branch
		const worktreeName = `pr-review-${draft.prIdentifier.replace(/[^a-zA-Z0-9]/g, "-")}`;
		const parentDir = project
			? join(dirname(repoPath), `${repoPath.split("/").pop()}-worktrees`)
			: join(repoPath, "..");
		const worktreePath = join(parentDir, worktreeName);

		// Remove stale worktree if it exists from a previous failed attempt
		if (existsSync(worktreePath)) {
			const { execSync } = await import("node:child_process");
			try {
				execSync(`git worktree remove --force '${worktreePath}'`, { cwd: repoPath });
			} catch {
				// If git worktree remove fails, try direct removal
				const { rmSync } = await import("node:fs");
				rmSync(worktreePath, { recursive: true, force: true });
				execSync("git worktree prune", { cwd: repoPath });
			}
		}

		await checkoutBranchWorktree(repoPath, worktreePath, draft.sourceBranch);

		// Capture commit SHA
		const { execSync } = await import("node:child_process");
		const commitSha = execSync("git rev-parse HEAD", { cwd: worktreePath }).toString().trim();

		// Resolve DB path using Electron's userData path
		const dbPath = join(app.getPath("userData"), "branchflux.db");

		db.update(schema.reviewDrafts)
			.set({ worktreePath, commitSha, updatedAt: new Date() })
			.where(eq(schema.reviewDrafts.id, draft.id))
			.run();

		// Create worktree + workspace DB records (following linkFromPR pattern)
		const worktreeId = nanoid();
		const workspaceId = nanoid();

		if (project) {
			// Clean up any stale DB records for this worktree path
			const existingWt = db
				.select()
				.from(schema.worktrees)
				.where(eq(schema.worktrees.path, worktreePath))
				.get();
			if (existingWt) {
				db.delete(schema.workspaces).where(eq(schema.workspaces.worktreeId, existingWt.id)).run();
				db.delete(schema.worktrees).where(eq(schema.worktrees.id, existingWt.id)).run();
			}

			db.insert(schema.worktrees)
				.values({
					id: worktreeId,
					projectId: project.id,
					path: worktreePath,
					branch: draft.sourceBranch,
					baseBranch: draft.targetBranch,
					createdAt: now,
					updatedAt: now,
				})
				.run();

			db.insert(schema.workspaces)
				.values({
					id: workspaceId,
					projectId: project.id,
					type: "worktree",
					name: `Review: ${draft.prTitle}`,
					worktreeId,
					terminalId: null,
					createdAt: now,
					updatedAt: now,
				})
				.run();
		}

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
		activeReviews.set(draft.id, { draftId: draft.id, cleanup: cleanupMcp });

		// Build the CLI command args
		const args = preset.buildArgs(launchOpts);
		const cliCommand = [preset.command, ...args].join(" ");

		// Write a launch script that sets env vars (if not handled by MCP config) and runs the CLI
		const launchScript = join(reviewDir, "start-review.sh");
		const envLines = preset.setupMcp
			? []
			: [
					`export REVIEW_DRAFT_ID='${draft.id}'`,
					`export PR_METADATA='${launchOpts.prMetadata.replace(/'/g, "'\\''")}'`,
					`export DB_PATH='${dbPath}'`,
				];
		const scriptContent = ["#!/bin/bash", ...envLines, "", cliCommand].join("\n");
		writeFileSync(launchScript, scriptContent, "utf-8");
		chmodSync(launchScript, 0o755);

		return {
			draftId: draft.id,
			workspaceId,
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
