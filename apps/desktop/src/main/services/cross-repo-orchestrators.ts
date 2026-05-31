import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { and, asc, eq, max } from "drizzle-orm";
import { app } from "electron";
import { nanoid } from "nanoid";
import { CLI_PRESETS } from "../ai-review/cli-presets";
import {
	invalidateAllCrossRepoLinks,
	removeCrossRepoEventsFile,
} from "../control-plane/orchestrator-event-sink";
import { getDb } from "../db";
import {
	type CrossRepoOrchestrator,
	crossRepoOrchestrators,
	orchestratorMembers,
} from "../db/schema";
import { attachToCrossRepoOrchestrator } from "./cross-repo-orchestrator-membership";
import { createWorkspace } from "./workspace-service";

function workDirFor(id: string): string {
	const base = app.getPath("userData");
	return join(base, "cross-repo-orchestrators", id);
}

export async function createCrossRepoOrchestrator(input: {
	name: string;
	agentKind: string;
}): Promise<string> {
	const id = `xro-${nanoid(8)}`;
	const db = getDb();
	const now = new Date();
	const dir = workDirFor(id);
	mkdirSync(dir, { recursive: true });

	const maxRow = db
		.select({ m: max(crossRepoOrchestrators.sortOrder) })
		.from(crossRepoOrchestrators)
		.get();
	const nextSort = (maxRow?.m ?? -1) + 1;

	db.insert(crossRepoOrchestrators)
		.values({
			id,
			name: input.name,
			workDir: dir,
			agentKind: input.agentKind,
			status: "idle",
			sortOrder: nextSort,
			createdAt: now,
			updatedAt: now,
		})
		.run();
	return id;
}

export async function getCrossRepoOrchestrator(input: {
	id: string;
}): Promise<CrossRepoOrchestrator | undefined> {
	return getDb()
		.select()
		.from(crossRepoOrchestrators)
		.where(eq(crossRepoOrchestrators.id, input.id))
		.get();
}

export async function listCrossRepoOrchestrators(): Promise<CrossRepoOrchestrator[]> {
	return getDb()
		.select()
		.from(crossRepoOrchestrators)
		.orderBy(asc(crossRepoOrchestrators.sortOrder))
		.all();
}

export async function renameCrossRepoOrchestrator(input: {
	id: string;
	name: string;
}): Promise<{ ok: true }> {
	getDb()
		.update(crossRepoOrchestrators)
		.set({ name: input.name, updatedAt: new Date() })
		.where(eq(crossRepoOrchestrators.id, input.id))
		.run();
	return { ok: true };
}

export async function deleteCrossRepoOrchestrator(input: { id: string }): Promise<{ ok: true }> {
	const row = await getCrossRepoOrchestrator({ id: input.id });
	if (!row) return { ok: true };
	try {
		rmSync(row.workDir, { recursive: true, force: true });
	} catch {}
	getDb()
		.delete(orchestratorMembers)
		.where(
			and(
				eq(orchestratorMembers.orchestratorId, input.id),
				eq(orchestratorMembers.parentKind, "cross_repo")
			)
		)
		.run();
	getDb().delete(crossRepoOrchestrators).where(eq(crossRepoOrchestrators.id, input.id)).run();
	removeCrossRepoEventsFile(input.id);
	invalidateAllCrossRepoLinks();
	return { ok: true };
}

const VALID_AGENT_KINDS = ["claude", "codex", "gemini", "opencode"] as const;
type AgentKind = (typeof VALID_AGENT_KINDS)[number];

function assertAgentKind(kind: string): AgentKind {
	if (VALID_AGENT_KINDS.includes(kind as AgentKind)) return kind as AgentKind;
	throw new Error(`unsupported agentKind: ${kind}`);
}

export async function getCoordinatorLaunch(input: {
	id: string;
}): Promise<{ cwd: string; command: string }> {
	const row = await getCrossRepoOrchestrator({ id: input.id });
	if (!row) throw new Error(`cross-repo orchestrator ${input.id} not found`);

	const agentKind = assertAgentKind(row.agentKind);
	const preset = CLI_PRESETS[agentKind];
	if (!preset) throw new Error(`no CLI preset for agentKind: ${agentKind}`);

	const command = [preset.command, preset.permissionFlag].filter(Boolean).join(" ");
	return { cwd: row.workDir, command };
}

export async function markAgentStarted(input: { id: string }): Promise<{ ok: true }> {
	getDb()
		.update(crossRepoOrchestrators)
		.set({ status: "working", updatedAt: new Date() })
		.where(eq(crossRepoOrchestrators.id, input.id))
		.run();
	return { ok: true };
}

export async function dispatchAcrossRepos(input: {
	orchestratorId: string;
	task: string;
	targets: Array<{ projectId: string; branch: string }>;
}): Promise<{ created: Array<{ projectId: string; workspaceId: string }> }> {
	const xro = await getCrossRepoOrchestrator({ id: input.orchestratorId });
	if (!xro) throw new Error(`cross-repo orchestrator ${input.orchestratorId} not found`);

	const created: Array<{ projectId: string; workspaceId: string }> = [];
	for (const t of input.targets) {
		const ws = await createWorkspace({ projectId: t.projectId, branch: t.branch });
		await attachToCrossRepoOrchestrator({
			orchestratorId: input.orchestratorId,
			workspaceId: ws.workspaceId,
		});
		created.push({ projectId: t.projectId, workspaceId: ws.workspaceId });
	}
	return { created };
}

export async function stopCrossRepoOrchestratorAgent(input: { id: string }): Promise<{ ok: true }> {
	// V1: flip status only. PID tracking and SIGTERM are a follow-up.
	getDb()
		.update(crossRepoOrchestrators)
		.set({ status: "idle", updatedAt: new Date() })
		.where(eq(crossRepoOrchestrators.id, input.id))
		.run();
	return { ok: true };
}
