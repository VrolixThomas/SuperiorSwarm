import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { and, desc, eq, gt, inArray, isNull, max, ne, or } from "drizzle-orm";
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
import { ForbiddenError, NotFoundError, ResumeNotSupportedError } from "../../shared/control-plane";
import type { ProjectWorkspaceTree, VisibleWorkspaceTreeRow } from "../../shared/types";
import { CLI_PRESETS } from "../ai-review/cli-presets";
import type { EventBus } from "../control-plane/event-bus";
import {
	invalidateOrchestratorPresenceCache,
	removeProjectEventsFile,
} from "../control-plane/orchestrator-event-sink";
import { getDb } from "../db";
import {
	agentMessages,
	orchestratorMembers,
	projects,
	sharedFiles,
	terminalSessions,
	workspaces,
	worktrees,
} from "../db/schema";
import { reviewDrafts } from "../db/schema-ai-review";
import {
	createWorktree,
	removeWorktree as gitRemoveWorktree,
	hasUncommittedChanges,
} from "../git/operations";
import { getWorktreeCleanupQueue } from "./worktree-cleanup-queue";
import { resolveWorkspaceCwd } from "./workspace-cwd";
import { symlinkSharedFiles } from "../shared-files";
import { getDaemonClient } from "../terminal/daemon-instance";
import { attachToOrchestrator } from "./orchestrator-membership";
function worktreeBasePath(repoPath: string): string {
	const parent = dirname(repoPath);
	const name = repoPath.split("/").pop() ?? "repo";
	return join(parent, `${name}-worktrees`);
}

let eventBus: EventBus | null = null;
export function setEventBus(bus: EventBus | null): void {
	eventBus = bus;
}

export interface CreateWorkspaceDeps {
	/** Test-only hook: called inside the DB transaction after the first insert. Throw to exercise transaction rollback. */
	_afterFirstInsert?: () => void;
}

export async function createWorkspace(
	input: CreateWorkspaceRequest,
	deps: CreateWorkspaceDeps = {}
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

	try {
		db.transaction((tx) => {
			tx.insert(worktrees)
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
			// Test-only hook fires inside the transaction after first insert — exercises transaction rollback.
			deps._afterFirstInsert?.();
			tx.insert(workspaces)
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
		});
	} catch (err) {
		// Roll back the on-disk worktree so a retry can succeed without manual cleanup.
		try {
			await gitRemoveWorktree(project.repoPath, path);
		} catch (rollbackErr) {
			console.warn("[workspace-service] createWorkspace rollback failed:", rollbackErr);
		}
		throw err;
	}

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
	type: "branch" | "worktree" | "review" | "folder";
	name: string;
	branch: string | null;
	worktreePath: string | null;
	folderPath: string | null;
	repoPath: string;
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
		path: resolveWorkspaceCwd({
			worktreePath: row.worktreePath,
			folderPath: row.folderPath,
			repoPath: row.repoPath,
		}),
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
	folderPath: workspaces.folderPath,
	repoPath: projects.repoPath,
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
		.innerJoin(projects, eq(workspaces.projectId, projects.id))
		.leftJoin(worktrees, eq(workspaces.worktreeId, worktrees.id))
		.leftJoin(reviewDrafts, eq(workspaces.reviewDraftId, reviewDrafts.id))
		.where(eq(workspaces.projectId, input.projectId))
		.all();

	return { workspaces: rows.map(rowToDto) };
}

const TREE_WORKSPACE_SELECT = {
	id: workspaces.id,
	projectId: workspaces.projectId,
	type: workspaces.type,
	name: workspaces.name,
	worktreeId: workspaces.worktreeId,
	terminalId: workspaces.terminalId,
	prProvider: workspaces.prProvider,
	prIdentifier: workspaces.prIdentifier,
	reviewDraftId: workspaces.reviewDraftId,
	createdAt: workspaces.createdAt,
	updatedAt: workspaces.updatedAt,
	worktreePath: worktrees.path,
	folderPath: workspaces.folderPath,
	draftStatus: reviewDrafts.status,
	draftCommitSha: reviewDrafts.commitSha,
	currentPhase: workspaces.currentPhase,
	statusText: workspaces.statusText,
	needs: workspaces.needs,
	isOrchestrator: workspaces.isOrchestrator,
	cliPreset: workspaces.cliPreset,
	sortOrder: workspaces.sortOrder,
} as const;

export async function listByProjectTree(input: {
	projectId: string;
}): Promise<ProjectWorkspaceTree> {
	const db = getDb();

	const rows = db
		.select(TREE_WORKSPACE_SELECT)
		.from(workspaces)
		.leftJoin(worktrees, eq(workspaces.worktreeId, worktrees.id))
		.leftJoin(reviewDrafts, eq(workspaces.reviewDraftId, reviewDrafts.id))
		.where(eq(workspaces.projectId, input.projectId))
		.all()
		.filter((r) => r.type !== "review") as VisibleWorkspaceTreeRow[];

	const memberRows = db
		.select({
			orchestratorId: orchestratorMembers.orchestratorId,
			workspaceId: orchestratorMembers.workspaceId,
			sortOrder: orchestratorMembers.sortOrder,
		})
		.from(orchestratorMembers)
		.innerJoin(workspaces, eq(workspaces.id, orchestratorMembers.workspaceId))
		.where(eq(workspaces.projectId, input.projectId))
		.all();

	const allOrchestratorIds = new Set(rows.filter((r) => r.isOrchestrator).map((r) => r.id));

	const memberOf = new Map<string, { orchestratorId: string; sortOrder: number }>();
	for (const m of memberRows) {
		if (!allOrchestratorIds.has(m.orchestratorId)) continue; // defensive: drop orphaned join rows
		memberOf.set(m.workspaceId, m);
	}

	const childrenByOrch = new Map<
		string,
		Array<{ row: VisibleWorkspaceTreeRow; sortOrder: number }>
	>();
	for (const ws of rows) {
		const mem = memberOf.get(ws.id);
		if (!mem) continue;
		const arr = childrenByOrch.get(mem.orchestratorId) ?? [];
		arr.push({ row: ws, sortOrder: mem.sortOrder });
		childrenByOrch.set(mem.orchestratorId, arr);
	}
	for (const arr of childrenByOrch.values()) {
		arr.sort((a, b) => a.sortOrder - b.sortOrder);
	}

	const orchestrators = rows
		.filter((r) => r.isOrchestrator)
		.sort((a, b) => a.sortOrder - b.sortOrder)
		.map((workspace) => ({
			workspace,
			children: (childrenByOrch.get(workspace.id) ?? []).map((c) => c.row),
		}));

	const loose = rows
		.filter((r) => !r.isOrchestrator && !memberOf.has(r.id))
		.sort((a, b) => a.sortOrder - b.sortOrder);

	return { orchestrators, loose };
}

export async function getWorkspace(input: GetWorkspaceRequest): Promise<GetWorkspaceResponse> {
	const db = getDb();
	const row = db
		.select(WORKSPACE_SELECT)
		.from(workspaces)
		.innerJoin(projects, eq(workspaces.projectId, projects.id))
		.leftJoin(worktrees, eq(workspaces.worktreeId, worktrees.id))
		.leftJoin(reviewDrafts, eq(workspaces.reviewDraftId, reviewDrafts.id))
		.where(eq(workspaces.id, input.workspaceId))
		.get();

	if (!row) {
		throw new NotFoundError(input.workspaceId);
	}
	if (row.projectId !== input.projectId) {
		throw new ForbiddenError("workspace belongs to a different project");
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
	if (!ws) throw new NotFoundError(input.workspaceId);
	if (ws.projectId !== input.projectId) throw new ForbiddenError();
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

	// DB cleanup is synchronous + immediate so the renderer's next list refetch
	// never sees this workspace again. Filesystem cleanup happens in the
	// background queue — the user does not wait on git.
	if (wt) db.delete(worktrees).where(eq(worktrees.id, wt.id)).run();
	db.delete(workspaces).where(eq(workspaces.id, input.workspaceId)).run();

	if (ws.isOrchestrator) {
		invalidateOrchestratorPresenceCache(ws.projectId);
		removeProjectEventsFile(ws.projectId);
	}

	if (pathExists && wt) {
		getWorktreeCleanupQueue().schedule(project.repoPath, wt.path);
	}

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

// Orchestrator coordination instructions are delivered via the superiorswarm
// MCP server (`instructions` field at initialize + per-tool reminders), not via
// prompt prepending — that keeps the rules visible across compaction and
// session restarts. See apps/desktop/mcp-standalone/server.mjs.

export function buildLaunchScript(opts: {
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
			? `--session-id '${escapeShellSingleQuote(opts.cliSessionId)}' `
			: "";
	// Per-preset invocation shape. Most CLIs accept a positional prompt; opencode
	// reserves the positional slot for `[project]` (a directory) and requires the
	// `run` subcommand to deliver a prompt as a message.
	const invocation = opts.cliPreset === "opencode" ? "opencode run" : opts.cliPreset;
	const cmd = `${invocation} ${sessionFlag}${flag}'${escapeShellSingleQuote(opts.prompt)}'`;
	return ["#!/bin/bash", `cd '${escapeShellSingleQuote(opts.cwd)}'`, "", cmd, ""].join("\n");
}

export async function dispatchAgent(
	input: DispatchAgentRequest,
	deps: DispatchAgentDeps = {}
): Promise<DispatchAgentResponse> {
	const db = getDb();
	const ws = db.select().from(workspaces).where(eq(workspaces.id, input.workspaceId)).get();
	if (!ws) throw new NotFoundError(input.workspaceId);
	if (ws.projectId !== input.projectId) throw new ForbiddenError();
	if (!ws.worktreeId) throw new Error("Workspace has no associated worktree");

	const wt = db.select().from(worktrees).where(eq(worktrees.id, ws.worktreeId)).get();
	if (!wt) throw new Error("Worktree row missing");

	const cliPreset = input.cliPreset ?? "claude";

	// Mint a candidate session id but do NOT persist until spawn succeeds.
	// Persisting up-front poisons future resumeAgent calls if the spawn throws.
	const cliSessionId = cliPreset === "claude" ? (ws.cliSessionId ?? randomUUID()) : null;

	const launchScriptContent = buildLaunchScript({
		cwd: wt.path,
		cliPreset,
		prompt: input.prompt,
		// Always skip permissions for dispatched agents — they run in their own
		// worktree and the user explicitly opted in by dispatching.
		skipPermissions: input.skipPermissions ?? true,
		cliSessionId,
	});

	const spawnFn = deps.spawnFn ?? defaultSpawnFn;
	const { sessionId, terminalId } = await spawnFn({
		cwd: wt.path,
		launchScriptContent,
		workspaceId: input.workspaceId,
	});

	// Spawn succeeded — only now persist the session id so resumeAgent has a
	// target that actually exists.
	if (cliPreset === "claude" && cliSessionId) {
		db.update(workspaces)
			.set({ cliSessionId, cliPreset: "claude", updatedAt: new Date() })
			.where(eq(workspaces.id, input.workspaceId))
			.run();
	}

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
	const dir = mkdtempSync(join(tmpdir(), "ss-dispatch-"));
	const scriptPath = join(dir, "launch.sh");
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
	if (!ws) throw new NotFoundError(ctx.workspaceId);
	if (ws.projectId !== ctx.projectId) throw new ForbiddenError();

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

export async function setOrchestrator(
	ctx: CallerContext,
	input: { workspaceId: string }
): Promise<{ ok: true }> {
	const db = getDb();
	const ws = db
		.select({ projectId: workspaces.projectId })
		.from(workspaces)
		.where(eq(workspaces.id, input.workspaceId))
		.get();
	if (!ws) throw new NotFoundError(input.workspaceId);
	if (ws.projectId !== ctx.projectId) {
		throw new ForbiddenError("cross-project setOrchestrator");
	}

	const now = new Date();
	db.update(workspaces)
		.set({ isOrchestrator: true, updatedAt: now })
		.where(eq(workspaces.id, input.workspaceId))
		.run();

	invalidateOrchestratorPresenceCache(ws.projectId);

	return { ok: true };
}

export async function unsetOrchestrator(
	ctx: CallerContext,
	input: { workspaceId: string }
): Promise<{ ok: true }> {
	const db = getDb();
	const ws = db
		.select({ projectId: workspaces.projectId })
		.from(workspaces)
		.where(eq(workspaces.id, input.workspaceId))
		.get();
	if (!ws) throw new NotFoundError(input.workspaceId);
	if (ws.projectId !== ctx.projectId) {
		throw new ForbiddenError("cross-project unsetOrchestrator");
	}

	const now = new Date();
	db.transaction((tx) => {
		tx.delete(orchestratorMembers)
			.where(eq(orchestratorMembers.orchestratorId, input.workspaceId))
			.run();
		tx.update(workspaces)
			.set({ isOrchestrator: false, updatedAt: now })
			.where(eq(workspaces.id, input.workspaceId))
			.run();
	});

	invalidateOrchestratorPresenceCache(ws.projectId);

	// Start the new orchestrator with a clean events log. Any prior log was
	// written for a previous orchestrator session and would confuse Monitor on
	// fresh boot.
	removeProjectEventsFile(ws.projectId);

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
		if (!target) throw new NotFoundError(input.toWorkspaceId);
		if (target.projectId !== ctx.projectId) {
			throw new ForbiddenError("cross-project message");
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
	const sinceDate = input.since ? new Date(input.since) : new Date(0);

	const targetFilter = includeBroadcasts
		? or(eq(agentMessages.toWorkspaceId, ctx.workspaceId), isNull(agentMessages.toWorkspaceId))
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

export interface RespawnAgentArgs {
	workspaceId: string;
	command: string;
	cwd: string;
}
export type RespawnAgentFn = (args: RespawnAgentArgs) => Promise<void>;

export interface ResumeAgentDeps {
	respawnAgent?: RespawnAgentFn;
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
	if (!callerWs) throw new NotFoundError(ctx.workspaceId);
	if (callerWs.projectId !== ctx.projectId) throw new ForbiddenError();
	if (!callerWs.isOrchestrator) {
		throw new ForbiddenError("caller is not the project orchestrator");
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
	if (!target) throw new NotFoundError(input.workspaceId);
	if (target.projectId !== ctx.projectId) throw new ForbiddenError();
	if (target.cliPreset !== "claude" || !target.cliSessionId) {
		throw new ResumeNotSupportedError("workspace has no claude session");
	}

	// 3. Resolve worktree path (cwd)
	const wt = target.worktreeId
		? db
				.select({ path: worktrees.path })
				.from(worktrees)
				.where(eq(worktrees.id, target.worktreeId))
				.get()
		: null;
	if (!wt?.path) throw new NotFoundError(`worktree path for ${input.workspaceId}`);

	// 4. Compose the resume command (interactive — no --print, so the child
	//    keeps running and can be resumed again on the next coordination event).
	//    --dangerously-skip-permissions matches the dispatch flow: orchestrated
	//    agents always run with permissions auto-approved.
	const escSession = escapeShellSingleQuote(target.cliSessionId);
	const escMsg = escapeShellSingleQuote(input.message);
	const command = `claude --resume '${escSession}' --dangerously-skip-permissions '${escMsg}'`;

	// 5. Kill the previous claude session (if any) and spawn a fresh one.
	//    Writing into a running claude PTY would inject the command as a user
	//    message instead of launching a new resume — we need a clean shell.
	const respawnFn = deps.respawnAgent ?? defaultRespawnAgent;
	await respawnFn({
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

export async function defaultRespawnAgent(args: RespawnAgentArgs): Promise<void> {
	const daemon = getDaemonClient();
	const db = getDb();

	// 1. Kill all existing terminal sessions for this workspace so the previous
	//    claude (or shell) exits cleanly. Writing into a live claude would land
	//    inside its input box as a typed message, not a new process.
	const sessions = db
		.select({ id: terminalSessions.id })
		.from(terminalSessions)
		.where(eq(terminalSessions.workspaceId, args.workspaceId))
		.all();
	for (const s of sessions) daemon?.dispose(s.id);
	if (sessions.length > 0) {
		db.delete(terminalSessions).where(eq(terminalSessions.workspaceId, args.workspaceId)).run();
	}

	// 2. Broadcast a fresh dispatch — renderer opens a new agent session tab
	//    whose first action is the resume command.
	const dir = mkdtempSync(join(tmpdir(), "ss-resume-"));
	const scriptPath = join(dir, "resume.sh");
	writeFileSync(
		scriptPath,
		["#!/bin/bash", `cd '${escapeShellSingleQuote(args.cwd)}'`, "", args.command, ""].join("\n"),
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

export interface CreateOrchestratorDeps {
	/** Override the inner createWorkspace call. Default: the module's real createWorkspace. */
	createWorkspaceFn?: (input: {
		projectId: string;
		branch: string;
		baseBranch?: string;
	}) => Promise<{ workspaceId: string; worktreeId: string }>;
	/** Test seam: override the per-id attach call. Default: the module's real attachToOrchestrator. */
	attachFn?: typeof attachToOrchestrator;
}

export async function createOrchestrator(
	input: {
		projectId: string;
		name: string;
		baseBranch: string;
		attachWorkspaceIds: string[];
	},
	deps: CreateOrchestratorDeps = {}
): Promise<{
	id: string;
	projectId: string;
	name: string;
	worktreeId: string;
	isOrchestrator: true;
}> {
	if (input.attachWorkspaceIds.length > 0) {
		const db = getDb();
		const rows = db
			.select({
				id: workspaces.id,
				projectId: workspaces.projectId,
				isOrchestrator: workspaces.isOrchestrator,
			})
			.from(workspaces)
			.where(inArray(workspaces.id, input.attachWorkspaceIds))
			.all();

		const found = new Set(rows.map((r) => r.id));
		for (const id of input.attachWorkspaceIds) {
			if (!found.has(id)) {
				throw new Error(`workspace ${id} not found`);
			}
		}
		for (const r of rows) {
			if (r.projectId !== input.projectId) {
				throw new Error(`workspace ${r.id} belongs to a different project`);
			}
			if (r.isOrchestrator) {
				throw new Error(`workspace ${r.id} is itself an orchestrator and cannot be attached`);
			}
		}
	}

	// Dedupe attach ids (preserve first-seen order) after the pre-check so the
	// downstream tx-loop never inserts duplicates.
	const attachIds = Array.from(new Set(input.attachWorkspaceIds));

	const create = deps.createWorkspaceFn ?? createWorkspace;
	const created = await create({
		projectId: input.projectId,
		branch: input.name,
		baseBranch: input.baseBranch,
	});

	const db = getDb();
	const doAttach = deps.attachFn;

	if (doAttach) {
		// Test seam: caller supplied a custom attach. Atomicity is enforced
		// manually: promote first, run attaches, and on any failure delete any
		// inserted member rows + revert the promotion. This mirrors the
		// production tx's all-or-nothing semantics for the test path.
		const now = new Date();
		db.update(workspaces)
			.set({ isOrchestrator: true, updatedAt: now })
			.where(eq(workspaces.id, created.workspaceId))
			.run();
		try {
			for (const wsId of attachIds) {
				await doAttach({ orchestratorId: created.workspaceId, workspaceId: wsId });
			}
		} catch (e) {
			db.delete(orchestratorMembers)
				.where(eq(orchestratorMembers.orchestratorId, created.workspaceId))
				.run();
			db.update(workspaces)
				.set({ isOrchestrator: false, updatedAt: new Date() })
				.where(eq(workspaces.id, created.workspaceId))
				.run();
			throw e;
		}
	} else {
		// Production path: a single db.transaction wraps the promote + the entire
		// attach loop, so a mid-loop failure rolls back the promote AND every
		// previously-inserted member row in one shot.
		db.transaction((tx) => {
			const now = new Date();
			tx.update(workspaces)
				.set({ isOrchestrator: true, updatedAt: now })
				.where(eq(workspaces.id, created.workspaceId))
				.run();

			for (const wsId of attachIds) {
				// Inlined equivalent of attachToOrchestrator's tx body so the
				// whole promote+attach sequence shares one transaction.
				tx.delete(orchestratorMembers)
					.where(eq(orchestratorMembers.workspaceId, wsId))
					.run();
				const maxRow = tx
					.select({ m: max(orchestratorMembers.sortOrder) })
					.from(orchestratorMembers)
					.where(eq(orchestratorMembers.orchestratorId, created.workspaceId))
					.get();
				const nextSort = (maxRow?.m ?? -1) + 1;
				tx.insert(orchestratorMembers)
					.values({
						orchestratorId: created.workspaceId,
						workspaceId: wsId,
						sortOrder: nextSort,
						createdAt: new Date(),
					})
					.run();
			}
		});
	}

	invalidateOrchestratorPresenceCache(input.projectId);

	return {
		id: created.workspaceId,
		projectId: input.projectId,
		name: input.name,
		worktreeId: created.worktreeId,
		isOrchestrator: true,
	};
}

export async function renameWorkspace(
	ctx: CallerContext,
	input: {
		workspaceId: string;
		name: string;
	}
): Promise<{ ok: true }> {
	const trimmed = input.name.trim();
	if (trimmed.length === 0) {
		throw new Error("name cannot be empty");
	}
	const db = getDb();
	const ws = db
		.select({ projectId: workspaces.projectId })
		.from(workspaces)
		.where(eq(workspaces.id, input.workspaceId))
		.get();
	if (!ws) throw new NotFoundError(input.workspaceId);
	if (ws.projectId !== ctx.projectId) {
		throw new ForbiddenError("cross-project renameWorkspace");
	}

	const dup = db
		.select({ id: workspaces.id })
		.from(workspaces)
		.where(
			and(
				eq(workspaces.projectId, ws.projectId),
				eq(workspaces.name, trimmed),
				ne(workspaces.id, input.workspaceId)
			)
		)
		.get();
	if (dup) throw new Error(`name "${trimmed}" already in use in this project`);

	db.update(workspaces)
		.set({ name: trimmed, updatedAt: new Date() })
		.where(eq(workspaces.id, input.workspaceId))
		.run();
	return { ok: true };
}
