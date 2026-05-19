import { app } from "electron";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { asc, eq, max } from "drizzle-orm";
import { nanoid } from "nanoid";
import { CLI_PRESETS } from "../ai-review/cli-presets";
import { getDb } from "../db";
import { crossRepoOrchestrators, type CrossRepoOrchestrator } from "../db/schema";
import { invalidateAllCrossRepoLinks, removeCrossRepoEventsFile } from "../control-plane/orchestrator-event-sink";
import { defaultSpawnFn } from "./workspace-service";

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
		.delete(crossRepoOrchestrators)
		.where(eq(crossRepoOrchestrators.id, input.id))
		.run();
	removeCrossRepoEventsFile(input.id);
	invalidateAllCrossRepoLinks();
	return { ok: true };
}

function escapeShellSingleQuote(s: string): string {
	return s.replace(/'/g, "'\\''");
}

const VALID_AGENT_KINDS = ["claude", "codex", "gemini", "opencode"] as const;
type AgentKind = (typeof VALID_AGENT_KINDS)[number];

function assertAgentKind(kind: string): AgentKind {
	if (VALID_AGENT_KINDS.includes(kind as AgentKind)) return kind as AgentKind;
	throw new Error(`unsupported agentKind: ${kind}`);
}

export async function startCrossRepoOrchestratorAgent(input: {
	id: string;
}): Promise<{ ok: true }> {
	const row = await getCrossRepoOrchestrator({ id: input.id });
	if (!row) throw new Error(`cross-repo orchestrator ${input.id} not found`);

	const agentKind = assertAgentKind(row.agentKind);
	const preset = CLI_PRESETS[agentKind];
	if (!preset) throw new Error(`no CLI preset for agentKind: ${agentKind}`);

	// Build a minimal launch script: cd into the XRO workDir and run the CLI.
	// The agent's cwd is used by context.resolve to identify the caller as a
	// cross-repo orchestrator (cwd-based lookup in control-plane/server.ts).
	// No prompt arg — the MCP server delivers instructions at initialize time.
	const escapedCwd = escapeShellSingleQuote(row.workDir);
	const parts = [preset.command, preset.permissionFlag].filter(Boolean).join(" ");
	const launchScriptContent = ["#!/bin/bash", `cd '${escapedCwd}'`, "", parts, ""].join("\n");

	// Use the XRO id as the workspaceId key — the renderer tab store treats it
	// as an opaque key (no DB lookup); it just scopes terminal tabs.
	await defaultSpawnFn({
		cwd: row.workDir,
		launchScriptContent,
		workspaceId: row.id,
	});

	getDb()
		.update(crossRepoOrchestrators)
		.set({ status: "working", updatedAt: new Date() })
		.where(eq(crossRepoOrchestrators.id, input.id))
		.run();

	return { ok: true };
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
