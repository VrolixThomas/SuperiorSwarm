import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, isNull, or } from "drizzle-orm";
import { nanoid } from "nanoid";
import type {
	AgentMessageDto,
	CreateWorkspaceRequest,
	CreateWorkspaceResponse,
	DispatchAgentRequest,
	DispatchAgentResponse,
	GetWorkspaceRequest,
	GetWorkspaceResponse,
	ListWorkspacesRequest,
	ListWorkspacesResponse,
	ReadMessagesRequest,
	ReadMessagesResponse,
	RemoveWorkspaceRequest,
	RemoveWorkspaceResponse,
	ResumeAgentRequest,
	ResumeAgentResponse,
	SendMessageRequest,
	SendMessageResponse,
	SetStatusRequest,
	SetStatusResponse,
	WorkspaceDto,
	WorkspacePhase,
} from "../../shared/control-plane";
import { CLI_PRESETS } from "../ai-review/cli-presets";
import { getDb } from "../db";
import { agentMessages, projects, sharedFiles, terminalSessions, workspaces, worktrees } from "../db/schema";
import { reviewDrafts } from "../db/schema-ai-review";
import {
	createWorktree,
	removeWorktree as gitRemoveWorktree,
	hasUncommittedChanges,
} from "../git/operations";
import { symlinkSharedFiles } from "../shared-files";
import { getDaemonClient } from "../terminal/daemon-instance";
import type { EventBus } from "../control-plane/event-bus";
import { type WorkspaceMcpEnv, writeWorkspaceMcpJson } from "./mcp-config";

function worktreeBasePath(repoPath: string): string {
	const parent = dirname(repoPath);
	const name = repoPath.split("/").pop() ?? "repo";
	return join(parent, `${name}-worktrees`);
}

let mcpEnvProvider: (workspaceId: string, projectId: string) => WorkspaceMcpEnv | null = () => null;
export function setMcpEnvProvider(
	fn: (workspaceId: string, projectId: string) => WorkspaceMcpEnv | null
): void {
	mcpEnvProvider = fn;
}

let eventBus: EventBus | null = null;
export function setEventBus(bus: EventBus | null): void {
	eventBus = bus;
}

export async function createWorkspace(
	input: CreateWorkspaceRequest
): Promise<CreateWorkspaceResponse> {
	const db = getDb();
	const project = db.select().from(projects).where(eq(projects.id, input.projectId)).get();
	if (!project) {
		throw new Error(`Project not found: ${input.projectId}`);
	}

	const baseBranch = input.baseBranch ?? project.defaultBranch;
	const path = join(worktreeBasePath(project.repoPath), input.branch);

	await createWorktree(project.repoPath, path, input.branch, baseBranch);

	const now = new Date();
	const worktreeId = nanoid();
	const workspaceId = nanoid();

	db.insert(worktrees)
		.values({
			id: worktreeId,
			projectId: input.projectId,
			path,
			branch: input.branch,
			baseBranch,
			createdAt: now,
			updatedAt: now,
		})
		.run();

	db.insert(workspaces)
		.values({
			id: workspaceId,
			projectId: input.projectId,
			type: "worktree",
			name: input.branch,
			worktreeId,
			terminalId: null,
			createdAt: now,
			updatedAt: now,
		})
		.run();

	const sharedEntries = db
		.select()
		.from(sharedFiles)
		.where(eq(sharedFiles.projectId, input.projectId))
		.all();

	if (sharedEntries.length > 0) {
		await symlinkSharedFiles(
			project.repoPath,
			path,
			sharedEntries.map((e) => ({ relativePath: e.relativePath, type: e.type }))
		);
	}

	const env = mcpEnvProvider(workspaceId, input.projectId);
	if (env) {
		try {
			writeWorkspaceMcpJson(path, env);
		} catch (err) {
			console.warn("[workspace-service] writeWorkspaceMcpJson failed:", err);
		}
	}

	return {
		workspaceId,
		worktreeId,
		path,
		branch: input.branch,
		baseBranch,
		createdAt: now,
		updatedAt: now,
	};
}

type WorkspaceRow = {
	id: string;
	projectId: string;
	type: "branch" | "worktree" | "review";
	name: string;
	branch: string | null;
	worktreePath: string | null;
	baseBranch: string | null;
	prProvider: string | null;
	prIdentifier: string | null;
	draftStatus: string | null;
	currentPhase: WorkspacePhase;
	statusText: string | null;
	needs: string | null;
	statusUpdatedAt: Date | null;
	isOrchestrator: boolean;
	cliPreset: string | null;
};

function rowToDto(row: WorkspaceRow): WorkspaceDto {
	return {
		id: row.id,
		projectId: row.projectId,
		type: row.type,
		name: row.name,
		branch: row.branch,
		worktreePath: row.worktreePath,
		baseBranch: row.baseBranch,
		prProvider: row.prProvider,
		prIdentifier: row.prIdentifier,
		draftStatus: row.draftStatus,
		currentPhase: row.currentPhase,
		statusText: row.statusText,
		needs: row.needs,
		statusUpdatedAt: row.statusUpdatedAt ? row.statusUpdatedAt.toISOString() : null,
		isOrchestrator: row.isOrchestrator,
		cliPreset: row.cliPreset,
	};
}

const WORKSPACE_SELECT = {
	id: workspaces.id,
	projectId: workspaces.projectId,
	type: workspaces.type,
	name: workspaces.name,
	branch: worktrees.branch,
	worktreePath: worktrees.path,
	baseBranch: worktrees.baseBranch,
	prProvider: workspaces.prProvider,
	prIdentifier: workspaces.prIdentifier,
	draftStatus: reviewDrafts.status,
	currentPhase: workspaces.currentPhase,
	statusText: workspaces.statusText,
	needs: workspaces.needs,
	statusUpdatedAt: workspaces.statusUpdatedAt,
	isOrchestrator: workspaces.isOrchestrator,
	cliPreset: workspaces.cliPreset,
} as const;

export async function listWorkspaces(
	input: ListWorkspacesRequest
): Promise<ListWorkspacesResponse> {
	const db = getDb();
	const rows = db
		.select(WORKSPACE_SELECT)
		.from(workspaces)
		.leftJoin(worktrees, eq(workspaces.worktreeId, worktrees.id))
		.leftJoin(reviewDrafts, eq(workspaces.reviewDraftId, reviewDrafts.id))
		.where(eq(workspaces.projectId, input.projectId))
		.all();

	return { workspaces: rows.map(rowToDto) };
}

export async function getWorkspace(input: GetWorkspaceRequest): Promise<GetWorkspaceResponse> {
	const db = getDb();
	const row = db
		.select(WORKSPACE_SELECT)
		.from(workspaces)
		.leftJoin(worktrees, eq(workspaces.worktreeId, worktrees.id))
		.leftJoin(reviewDrafts, eq(workspaces.reviewDraftId, reviewDrafts.id))
		.where(eq(workspaces.id, input.workspaceId))
		.get();

	if (!row) {
		throw new Error(`not_found: ${input.workspaceId}`);
	}
	if (row.projectId !== input.projectId) {
		throw new Error(`forbidden: workspace belongs to a different project`);
	}

	const dirty =
		row.worktreePath && existsSync(row.worktreePath)
			? await hasUncommittedChanges(row.worktreePath)
			: false;
	return { ...rowToDto(row), hasUncommittedChanges: dirty };
}

export async function removeWorkspace(
	input: RemoveWorkspaceRequest
): Promise<RemoveWorkspaceResponse> {
	const db = getDb();
	const ws = db.select().from(workspaces).where(eq(workspaces.id, input.workspaceId)).get();
	if (!ws) throw new Error(`not_found: ${input.workspaceId}`);
	if (ws.projectId !== input.projectId) throw new Error("forbidden");
	if (ws.type === "branch") throw new Error("Cannot delete the main branch workspace");

	const wt = ws.worktreeId
		? db.select().from(worktrees).where(eq(worktrees.id, ws.worktreeId)).get()
		: null;
	const project = db.select().from(projects).where(eq(projects.id, ws.projectId)).get();
	if (!project) throw new Error("Project not found");

	const pathExists = wt ? existsSync(wt.path) : false;
	if (pathExists && wt && !input.force) {
		const dirty = await hasUncommittedChanges(wt.path);
		if (dirty) return { status: "blocked_uncommitted" };
	}

	const sessions = db
		.select({ id: terminalSessions.id })
		.from(terminalSessions)
		.where(eq(terminalSessions.workspaceId, input.workspaceId))
		.all();
	const daemon = getDaemonClient();
	for (const s of sessions) daemon?.dispose(s.id);
	if (sessions.length > 0) {
		db.delete(terminalSessions).where(eq(terminalSessions.workspaceId, input.workspaceId)).run();
	}

	if (pathExists && wt) {
		await gitRemoveWorktree(project.repoPath, wt.path);
	}

	if (wt) db.delete(worktrees).where(eq(worktrees.id, wt.id)).run();
	db.delete(workspaces).where(eq(workspaces.id, input.workspaceId)).run();

	return { status: "removed" };
}

export interface SpawnArgs {
	cwd: string;
	launchScriptContent: string;
	workspaceId: string;
}
export interface SpawnResult {
	sessionId: string;
	terminalId: string;
}
export type SpawnFn = (args: SpawnArgs) => Promise<SpawnResult>;

export interface DispatchAgentDeps {
	spawnFn?: SpawnFn;
}

function escapeShellSingleQuote(s: string): string {
	return s.replace(/'/g, "'\\''");
}

function buildLaunchScript(opts: {
	cwd: string;
	cliPreset: "claude" | "codex" | "gemini" | "opencode";
	prompt: string;
	skipPermissions: boolean;
	cliSessionId: string | null;
}): string {
	const presetFlag = opts.skipPermissions ? CLI_PRESETS[opts.cliPreset]?.permissionFlag : undefined;
	const flag = presetFlag ? `${presetFlag} ` : "";
	const sessionFlag =
		opts.cliPreset === "claude" && opts.cliSessionId
			? `--session-id '${escapeShellSingleQuote(opts.cliSessionId)}' --print `
			: "";
	const cmd = `${opts.cliPreset} ${sessionFlag}${flag}'${escapeShellSingleQuote(opts.prompt)}'`;
	return ["#!/bin/bash", `cd '${escapeShellSingleQuote(opts.cwd)}'`, "", cmd, ""].join("\n");
}

export async function dispatchAgent(
	input: DispatchAgentRequest,
	deps: DispatchAgentDeps = {}
): Promise<DispatchAgentResponse> {
	const db = getDb();
	const ws = db.select().from(workspaces).where(eq(workspaces.id, input.workspaceId)).get();
	if (!ws) throw new Error(`not_found: ${input.workspaceId}`);
	if (ws.projectId !== input.projectId) throw new Error("forbidden");
	if (!ws.worktreeId) throw new Error("Workspace has no associated worktree");

	const wt = db.select().from(worktrees).where(eq(worktrees.id, ws.worktreeId)).get();
	if (!wt) throw new Error("Worktree row missing");

	const cliPreset = input.cliPreset ?? "claude";

	// Mint or reuse a claude session id so resumeAgent can target it later
	let cliSessionId: string | null = null;
	if (cliPreset === "claude") {
		cliSessionId = ws.cliSessionId ?? randomUUID();
		db.update(workspaces)
			.set({
				cliSessionId,
				cliPreset: "claude",
				updatedAt: new Date(),
			})
			.where(eq(workspaces.id, input.workspaceId))
			.run();
	}

	const launchScriptContent = buildLaunchScript({
		cwd: wt.path,
		cliPreset,
		prompt: input.prompt,
		skipPermissions: input.skipPermissions ?? false,
		cliSessionId,
	});

	const spawnFn = deps.spawnFn ?? defaultSpawnFn;
	const { sessionId, terminalId } = await spawnFn({
		cwd: wt.path,
		launchScriptContent,
		workspaceId: input.workspaceId,
	});

	return { sessionId, terminalId, status: "started" };
}

export interface AgentDispatchBroadcast {
	workspaceId: string;
	cwd: string;
	scriptPath: string;
	title: string;
}

let dispatchBroadcaster: (payload: AgentDispatchBroadcast) => void = () => {
	throw new Error(
		"Agent dispatch broadcaster not registered — main process must call setDispatchBroadcaster at boot"
	);
};

export function setDispatchBroadcaster(fn: (payload: AgentDispatchBroadcast) => void): void {
	dispatchBroadcaster = fn;
}

export async function defaultSpawnFn(args: SpawnArgs): Promise<SpawnResult> {
	const { mkdtempSync, writeFileSync, chmodSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join: joinPath } = await import("node:path");

	const dir = mkdtempSync(joinPath(tmpdir(), "ss-dispatch-"));
	const scriptPath = joinPath(dir, "launch.sh");
	writeFileSync(scriptPath, args.launchScriptContent, "utf-8");
	chmodSync(scriptPath, 0o755);

	const sessionId = nanoid();
	const terminalId = sessionId;

	dispatchBroadcaster({
		workspaceId: args.workspaceId,
		cwd: args.cwd,
		scriptPath,
		title: "Agent session",
	});

	return { sessionId, terminalId };
}

export interface CallerContext {
	workspaceId: string;
	projectId: string;
}

export async function setStatus(
	ctx: CallerContext,
	input: SetStatusRequest
): Promise<SetStatusResponse> {
	const db = getDb();
	const ws = db
		.select({ projectId: workspaces.projectId })
		.from(workspaces)
		.where(eq(workspaces.id, ctx.workspaceId))
		.get();
	if (!ws) throw new Error(`not_found: ${ctx.workspaceId}`);
	if (ws.projectId !== ctx.projectId) throw new Error("forbidden");

	const now = new Date();
	db.update(workspaces)
		.set({
			currentPhase: input.phase,
			statusText: input.statusText ?? null,
			needs: input.needs ?? null,
			statusUpdatedAt: now,
			updatedAt: now,
		})
		.where(eq(workspaces.id, ctx.workspaceId))
		.run();

	eventBus?.emit(ctx.projectId, {
		event: "status",
		workspaceId: ctx.workspaceId,
		phase: input.phase,
		statusText: input.statusText ?? null,
		needs: input.needs ?? null,
		ts: now.toISOString(),
	});

	return { ok: true };
}

export async function setOrchestrator(input: { workspaceId: string }): Promise<{ ok: true }> {
	const db = getDb();
	const ws = db
		.select({ projectId: workspaces.projectId })
		.from(workspaces)
		.where(eq(workspaces.id, input.workspaceId))
		.get();
	if (!ws) throw new Error(`not_found: ${input.workspaceId}`);

	const now = new Date();
	db.transaction((tx) => {
		tx.update(workspaces)
			.set({ isOrchestrator: false, updatedAt: now })
			.where(eq(workspaces.projectId, ws.projectId))
			.run();
		tx.update(workspaces)
			.set({ isOrchestrator: true, updatedAt: now })
			.where(eq(workspaces.id, input.workspaceId))
			.run();
	});

	return { ok: true };
}

function messageRowToDto(row: typeof agentMessages.$inferSelect): AgentMessageDto {
	return {
		id: row.id,
		fromWorkspaceId: row.fromWorkspaceId,
		toWorkspaceId: row.toWorkspaceId,
		kind: row.kind,
		content: row.content,
		inReplyTo: row.inReplyTo,
		createdAt: row.createdAt.toISOString(),
	};
}

export async function sendMessage(
	ctx: CallerContext,
	input: SendMessageRequest
): Promise<SendMessageResponse> {
	const db = getDb();

	if (input.toWorkspaceId) {
		const target = db
			.select({ projectId: workspaces.projectId })
			.from(workspaces)
			.where(eq(workspaces.id, input.toWorkspaceId))
			.get();
		if (!target) throw new Error(`not_found: ${input.toWorkspaceId}`);
		if (target.projectId !== ctx.projectId) {
			throw new Error("forbidden: cross-project message");
		}
	}

	const messageId = nanoid();
	db.insert(agentMessages)
		.values({
			id: messageId,
			projectId: ctx.projectId,
			fromWorkspaceId: ctx.workspaceId,
			toWorkspaceId: input.toWorkspaceId ?? null,
			kind: input.kind,
			content: input.content,
			inReplyTo: input.inReplyTo ?? null,
			createdAt: new Date(),
		})
		.run();

	eventBus?.emit(ctx.projectId, {
		event: "message",
		messageId,
		from: ctx.workspaceId,
		to: input.toWorkspaceId ?? null,
		kind: input.kind,
		content: input.content,
		ts: new Date().toISOString(),
	});

	return { messageId };
}

export async function readMessages(
	ctx: CallerContext,
	input: ReadMessagesRequest
): Promise<ReadMessagesResponse> {
	const db = getDb();
	const includeBroadcasts = input.includeBroadcasts ?? true;
	const sinceDate = input.since
		? new Date(input.since)
		: new Date(Date.now() - 60 * 60 * 1000);

	const targetFilter = includeBroadcasts
		? or(
				eq(agentMessages.toWorkspaceId, ctx.workspaceId),
				isNull(agentMessages.toWorkspaceId)
			)
		: eq(agentMessages.toWorkspaceId, ctx.workspaceId);

	const rows = db
		.select()
		.from(agentMessages)
		.where(
			and(
				eq(agentMessages.projectId, ctx.projectId),
				gt(agentMessages.createdAt, sinceDate),
				targetFilter
			)
		)
		.orderBy(desc(agentMessages.createdAt))
		.limit(200)
		.all();

	return { messages: rows.map(messageRowToDto) };
}

export interface WriteToTerminalArgs {
	workspaceId: string;
	command: string;
	cwd: string;
}
export type WriteToTerminalFn = (args: WriteToTerminalArgs) => Promise<void>;

export interface ResumeAgentDeps {
	writeToTerminal?: WriteToTerminalFn;
}

function escapeShellSingleQuoteMsg(s: string): string {
	return s.replace(/'/g, "'\\''");
}

export async function resumeAgent(
	ctx: CallerContext,
	input: ResumeAgentRequest,
	deps: ResumeAgentDeps = {}
): Promise<ResumeAgentResponse> {
	const db = getDb();

	// 1. Authorize: caller must be project orchestrator
	const callerWs = db
		.select({
			projectId: workspaces.projectId,
			isOrchestrator: workspaces.isOrchestrator,
		})
		.from(workspaces)
		.where(eq(workspaces.id, ctx.workspaceId))
		.get();
	if (!callerWs) throw new Error(`not_found: ${ctx.workspaceId}`);
	if (callerWs.projectId !== ctx.projectId) throw new Error("forbidden");
	if (!callerWs.isOrchestrator) {
		throw new Error("forbidden: caller is not the project orchestrator");
	}

	// 2. Look up target
	const target = db
		.select({
			projectId: workspaces.projectId,
			worktreeId: workspaces.worktreeId,
			cliSessionId: workspaces.cliSessionId,
			cliPreset: workspaces.cliPreset,
		})
		.from(workspaces)
		.where(eq(workspaces.id, input.workspaceId))
		.get();
	if (!target) throw new Error(`not_found: ${input.workspaceId}`);
	if (target.projectId !== ctx.projectId) throw new Error("forbidden");
	if (target.cliPreset !== "claude" || !target.cliSessionId) {
		throw new Error("resume_not_supported: workspace has no claude session");
	}

	// 3. Resolve worktree path (cwd)
	const wt = target.worktreeId
		? db
				.select({ path: worktrees.path })
				.from(worktrees)
				.where(eq(worktrees.id, target.worktreeId))
				.get()
		: null;
	if (!wt?.path) throw new Error(`not_found: worktree path for ${input.workspaceId}`);

	// 4. Compose the resume command
	const escSession = escapeShellSingleQuoteMsg(target.cliSessionId);
	const escMsg = escapeShellSingleQuoteMsg(input.message);
	const command = `claude --resume '${escSession}' --print '${escMsg}'\n`;

	// 5. Write to terminal first — if this fails, no audit row + no event
	const writeFn = deps.writeToTerminal ?? defaultWriteToTerminal;
	await writeFn({
		workspaceId: input.workspaceId,
		command,
		cwd: wt.path,
	});

	// 6. Insert agent_messages row (audit log)
	const messageId = nanoid();
	db.insert(agentMessages)
		.values({
			id: messageId,
			projectId: ctx.projectId,
			fromWorkspaceId: ctx.workspaceId,
			toWorkspaceId: input.workspaceId,
			kind: "resume",
			content: input.message,
			inReplyTo: null,
			createdAt: new Date(),
		})
		.run();

	// 7. Emit on bus
	eventBus?.emit(ctx.projectId, {
		event: "message",
		messageId,
		from: ctx.workspaceId,
		to: input.workspaceId,
		kind: "resume",
		content: input.message,
		ts: new Date().toISOString(),
	});

	return { ok: true, messageId };
}

export async function defaultWriteToTerminal(args: WriteToTerminalArgs): Promise<void> {
	const daemon = getDaemonClient();
	if (!daemon) throw new Error("Terminal daemon not available");

	const db = getDb();
	const existing = db
		.select({ id: terminalSessions.id })
		.from(terminalSessions)
		.where(eq(terminalSessions.workspaceId, args.workspaceId))
		.orderBy(desc(terminalSessions.updatedAt))
		.limit(1)
		.get();

	if (existing) {
		daemon.write(existing.id, args.command);
		return;
	}

	// No existing terminal — broadcast a dispatch so the renderer opens a new tab.
	const { mkdtempSync, writeFileSync, chmodSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join: joinPath } = await import("node:path");
	const dir = mkdtempSync(joinPath(tmpdir(), "ss-resume-"));
	const scriptPath = joinPath(dir, "resume.sh");
	writeFileSync(
		scriptPath,
		["#!/bin/bash", `cd '${escapeShellSingleQuoteMsg(args.cwd)}'`, "", args.command, ""].join(
			"\n"
		),
		"utf-8"
	);
	chmodSync(scriptPath, 0o755);
	dispatchBroadcaster({
		workspaceId: args.workspaceId,
		cwd: args.cwd,
		scriptPath,
		title: "Agent session",
	});
}
