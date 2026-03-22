import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { eq } from "drizzle-orm";
import { app } from "electron";
import type { ReviewCommentFromPlatform } from "../../shared/resolution-types";
import { getBitbucketPRComments } from "../atlassian/bitbucket";
import { getDb } from "../db";
import { resolutionComments, resolutionSessions } from "../db/schema-resolution";
import { getPRDetails, getPRFiles } from "../github/github";
import {
	CLI_PRESETS,
	type LaunchOptions,
	buildResolutionMcpInstructions,
	isCliInstalled,
	resolveCliPath,
} from "./cli-presets";
import { getSettings } from "./orchestrator";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ResolutionPromptInput {
	prNumber: number;
	prTitle: string;
	sourceBranch: string;
	targetBranch: string;
	comments: Array<{
		id: string;
		author: string;
		filePath: string | null;
		lineNumber: number | null;
		body: string;
	}>;
}

export interface ResolutionLaunchInfo {
	sessionId: string;
	launchScript: string;
	promptPath: string;
}

// ─── Pure prompt builder (no DB access) ──────────────────────────────────────

export function buildResolutionPrompt(input: ResolutionPromptInput): string {
	const lines: string[] = [];

	lines.push(`# Resolve Review Comments — PR #${input.prNumber}: ${input.prTitle}`);
	lines.push("");
	lines.push(`Branch: ${input.sourceBranch} → ${input.targetBranch}`);
	lines.push("");

	if (input.comments.length === 0) {
		lines.push("No review comments to resolve.");
	} else {
		lines.push(`## Review Comments (${input.comments.length})`);
		lines.push("");
		for (const comment of input.comments) {
			const location = comment.filePath
				? comment.lineNumber
					? `${comment.author} on ${comment.filePath}:${comment.lineNumber}`
					: `${comment.author} on ${comment.filePath}`
				: `${comment.author} (general)`;
			lines.push(`### [${comment.id}] ${location}`);
			lines.push(comment.body);
			lines.push("");
		}
	}

	lines.push("## Instructions");
	lines.push("");
	lines.push(
		"You are resolving review comments on this pull request. For each comment, read the code,"
	);
	lines.push(
		"understand the reviewer's concern, and make the appropriate code changes to address it."
	);
	lines.push("");
	lines.push(buildResolutionMcpInstructions());

	return lines.join("\n");
}

// ─── PR identifier parser ────────────────────────────────────────────────────

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

// ─── Fetch review comments from platform ─────────────────────────────────────

export async function fetchReviewComments(
	provider: string,
	prIdentifier: string
): Promise<ReviewCommentFromPlatform[]> {
	const { ownerOrWorkspace, repo, number: prNumber } = parsePrIdentifier(prIdentifier);

	if (provider === "github") {
		const details = await getPRDetails(ownerOrWorkspace, repo, prNumber);

		// Build rename map: old path → new path for renamed files via REST API
		const files = await getPRFiles(ownerOrWorkspace, repo, prNumber);
		const renameMap = new Map<string, string>();
		for (const file of files) {
			if (file.status === "renamed" && file.previousPath) {
				renameMap.set(file.previousPath, file.path);
			}
		}

		// Filter to unresolved threads only
		const comments: ReviewCommentFromPlatform[] = [];
		for (const thread of details.reviewThreads) {
			if (thread.isResolved) continue;

			const firstComment = thread.comments[0];
			if (!firstComment) continue;

			// Remap path if the file was renamed
			const filePath = renameMap.get(thread.path) ?? thread.path;

			comments.push({
				platformCommentId: firstComment.id,
				platformThreadId: thread.id,
				author: firstComment.author,
				body: firstComment.body,
				filePath,
				lineNumber: thread.line,
			});
		}

		return comments;
	}

	if (provider === "bitbucket") {
		const rawComments = await getBitbucketPRComments(ownerOrWorkspace, repo, prNumber);

		// Filter to top-level comments only (no replies)
		return rawComments
			.filter((c) => c.parentId === null)
			.map((c) => ({
				platformCommentId: String(c.id),
				platformThreadId: null,
				author: c.author,
				body: c.body,
				filePath: c.filePath,
				lineNumber: c.lineNumber,
			}));
	}

	throw new Error(`Unsupported provider: ${provider}`);
}

// ─── Session lifecycle ───────────────────────────────────────────────────────

export async function startResolutionSession(params: {
	workspaceId: string;
	worktreePath: string;
	prProvider: string;
	prIdentifier: string;
	prTitle: string;
	prNumber: number;
	sourceBranch: string;
	targetBranch: string;
}): Promise<ResolutionLaunchInfo> {
	const db = getDb();
	const now = new Date();

	// Guard: reject if there's already a running session for this workspace
	const existing = db
		.select()
		.from(resolutionSessions)
		.where(eq(resolutionSessions.workspaceId, params.workspaceId))
		.all()
		.find((s) => s.status === "running");

	if (existing) {
		throw new Error("A resolution session is already running for this workspace");
	}

	// Capture commit SHA before resolution starts
	const { execSync } = await import("node:child_process");
	const commitShaBefore = execSync("git rev-parse HEAD", { cwd: params.worktreePath })
		.toString()
		.trim();

	// Fetch comments from the platform
	const platformComments = await fetchReviewComments(params.prProvider, params.prIdentifier);

	// Create the session
	const sessionId = randomUUID();
	db.insert(resolutionSessions)
		.values({
			id: sessionId,
			workspaceId: params.workspaceId,
			prProvider: params.prProvider,
			prIdentifier: params.prIdentifier,
			commitShaBefore,
			status: "running",
			createdAt: now,
			updatedAt: now,
		})
		.run();

	// Insert each comment into the DB
	for (const comment of platformComments) {
		db.insert(resolutionComments)
			.values({
				id: randomUUID(),
				sessionId,
				groupId: null,
				platformCommentId: comment.platformCommentId,
				platformThreadId: comment.platformThreadId,
				filePath: comment.filePath,
				lineNumber: comment.lineNumber,
				author: comment.author,
				body: comment.body,
				status: "pending",
				updatedAt: now,
			})
			.run();
	}

	// Build prompt
	const promptComments = platformComments.map((c) => ({
		id: c.platformCommentId,
		author: c.author,
		filePath: c.filePath,
		lineNumber: c.lineNumber,
		body: c.body,
	}));

	const promptText = buildResolutionPrompt({
		prNumber: params.prNumber,
		prTitle: params.prTitle,
		sourceBranch: params.sourceBranch,
		targetBranch: params.targetBranch,
		comments: promptComments,
	});

	// Write prompt to file
	const reviewDir = join(app.getPath("userData"), "resolutions", sessionId);
	mkdirSync(reviewDir, { recursive: true });

	const promptPath = join(reviewDir, "resolution-prompt.txt");
	writeFileSync(promptPath, promptText, "utf-8");

	// Build launch script
	const settings = getSettings();
	const preset = CLI_PRESETS[settings.cliPreset];
	if (!preset) throw new Error(`Unknown CLI preset: ${settings.cliPreset}`);
	if (!isCliInstalled(preset.command)) {
		throw new Error(`CLI tool '${preset.command}' is not installed`);
	}

	const dbPath = join(app.getPath("userData"), "branchflux.db");
	const mcpServerPath = resolve(dirname(__dirname), "..", "mcp-standalone", "server.mjs");

	const prMetadata = JSON.stringify({
		title: params.prTitle,
		description: "",
		author: "",
		sourceBranch: params.sourceBranch,
		targetBranch: params.targetBranch,
		reviewers: [],
		provider: params.prProvider,
		prUrl: "",
	});

	const launchOpts: LaunchOptions = {
		mcpServerPath,
		worktreePath: params.worktreePath,
		reviewDir,
		promptFilePath: promptPath,
		dbPath,
		reviewDraftId: sessionId, // Reuse field for session ID
		prMetadata,
	};

	// Setup MCP config
	preset.setupMcp?.(launchOpts);

	// Build CLI command
	const args = preset.buildArgs(launchOpts);
	const resolvedCommand = resolveCliPath(preset.command);
	const parts = [resolvedCommand];
	if (settings.skipPermissions && preset.permissionFlag) {
		parts.push(preset.permissionFlag);
	}
	parts.push(...args);
	const cliCommand = parts.join(" ");

	// Write launch script
	const launchScript = join(reviewDir, "start-resolution.sh");
	const envLines = preset.setupMcp
		? []
		: [
				`export REVIEW_DRAFT_ID='${sessionId}'`,
				`export PR_METADATA='${prMetadata.replace(/'/g, "'\\''")}'`,
				`export DB_PATH='${dbPath}'`,
			];

	const scriptContent = [
		"#!/bin/bash",
		`cd '${params.worktreePath}'`,
		...envLines,
		"",
		cliCommand,
	].join("\n");

	writeFileSync(launchScript, scriptContent, "utf-8");
	chmodSync(launchScript, 0o755);

	return { sessionId, launchScript, promptPath };
}

// ─── Failure handling ────────────────────────────────────────────────────────

export function markSessionFailed(sessionId: string): void {
	const db = getDb();
	db.update(resolutionSessions)
		.set({ status: "failed", updatedAt: new Date() })
		.where(eq(resolutionSessions.id, sessionId))
		.run();
}

// ─── Startup cleanup ────────────────────────────────────────────────────────

export function cleanupStaleResolutionSessions(): void {
	const db = getDb();
	const stale = db
		.select()
		.from(resolutionSessions)
		.where(eq(resolutionSessions.status, "running"))
		.all();

	for (const session of stale) {
		db.update(resolutionSessions)
			.set({ status: "failed", updatedAt: new Date() })
			.where(eq(resolutionSessions.id, session.id))
			.run();
	}

	if (stale.length > 0) {
		console.log(`[ai-review] Cleaned up ${stale.length} stale resolution session(s)`);
	}
}

// ─── Terminal exit monitoring ────────────────────────────────────────────────

export function monitorAgentExit(sessionId: string, _terminalId: string): void {
	const db = getDb();
	const session = db
		.select()
		.from(resolutionSessions)
		.where(eq(resolutionSessions.id, sessionId))
		.get();

	if (session && session.status === "running") {
		markSessionFailed(sessionId);
		console.log(
			`[ai-review] Resolution session ${sessionId} marked failed (terminal exited while running)`
		);
	}
}
