import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { CLI_PRESETS } from "../ai-review/cli-presets";
import { writeWorkspaceMcpJson, type WorkspaceMcpEnv } from "./mcp-config";
import type {
	CreateWorkspaceRequest,
	CreateWorkspaceResponse,
	DispatchAgentRequest,
	DispatchAgentResponse,
	GetWorkspaceRequest,
	GetWorkspaceResponse,
	ListWorkspacesRequest,
	ListWorkspacesResponse,
	RemoveWorkspaceRequest,
	RemoveWorkspaceResponse,
	WorkspaceDto,
} from "../../shared/control-plane";
import { getDb } from "../db";
import { reviewDrafts } from "../db/schema-ai-review";
import { projects, sharedFiles, terminalSessions, workspaces, worktrees } from "../db/schema";
import { createWorktree, hasUncommittedChanges, removeWorktree as gitRemoveWorktree } from "../git/operations";
import { getDaemonClient } from "../terminal/daemon-instance";
import { symlinkSharedFiles } from "../shared-files";

function worktreeBasePath(repoPath: string): string {
	const parent = dirname(repoPath);
	const name = repoPath.split("/").pop() ?? "repo";
	return join(parent, `${name}-worktrees`);
}

let mcpEnvProvider: (projectId: string) => WorkspaceMcpEnv | null = () => null;
export function setMcpEnvProvider(fn: (projectId: string) => WorkspaceMcpEnv | null): void {
	mcpEnvProvider = fn;
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

	const env = mcpEnvProvider(input.projectId);
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

export async function getWorkspace(
	input: GetWorkspaceRequest
): Promise<GetWorkspaceResponse> {
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
}): string {
	const presetFlag = opts.skipPermissions ? CLI_PRESETS[opts.cliPreset]?.permissionFlag : undefined;
	const flag = presetFlag ? `${presetFlag} ` : "";
	const cmd = `${opts.cliPreset} ${flag}'${escapeShellSingleQuote(opts.prompt)}'`;
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
	const launchScriptContent = buildLaunchScript({
		cwd: wt.path,
		cliPreset,
		prompt: input.prompt,
		skipPermissions: input.skipPermissions ?? false,
	});

	const spawnFn = deps.spawnFn ?? defaultSpawnFn;
	const { sessionId, terminalId } = await spawnFn({
		cwd: wt.path,
		launchScriptContent,
		workspaceId: input.workspaceId,
	});

	return { sessionId, terminalId, status: "started" };
}

export async function defaultSpawnFn(_args: SpawnArgs): Promise<SpawnResult> {
	throw new Error(
		"defaultSpawnFn not implemented — call dispatchAgent with deps.spawnFn until the control plane wires the real spawn"
	);
}
