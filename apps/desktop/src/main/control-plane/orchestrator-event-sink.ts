import { appendFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { crossRepoOrchestratorProjects, workspaces } from "../db/schema";
import type { EventBus } from "./event-bus";

// Per-project events live in <userData>/events/<projectId>.jsonl, outside
// the user's repo so they can never leak into `git status` or be committed.
// The orchestrator agent learns the absolute path through the superiorswarm
// MCP server's instructions (see mcp-standalone/server.mjs).
//
// Cross-repo orchestrator events live in <userData>/events/cross-repo/<xroId>.jsonl.
// Every event emitted for a project is fanned out to all cross-repo orchestrators
// that have linked that project.

let eventsDir: string | null = null;

// Per-project cache: does this project currently have an orchestrator?
// true = write events, false = skip, undefined (missing key) = not yet cached.
const orchestratorPresence = new Map<string, boolean>();

// Per-project cache: which cross-repo orchestrator IDs link this project?
const crossRepoLinks = new Map<string, string[]>(); // projectId → xro ids

export function setEventsDir(dir: string): void {
	eventsDir = dir;
	mkdirSync(dir, { recursive: true });
	mkdirSync(join(dir, "cross-repo"), { recursive: true });
}

export function eventsFilePathForProject(projectId: string): string {
	if (!eventsDir) throw new Error("events dir not configured — call setEventsDir() at startup");
	return join(eventsDir, `${projectId}.jsonl`);
}

export function crossRepoEventsFilePath(orchestratorId: string): string {
	if (!eventsDir) throw new Error("events dir not configured — call setEventsDir() at startup");
	return join(eventsDir, "cross-repo", `${orchestratorId}.jsonl`);
}

export function invalidateOrchestratorPresenceCache(projectId: string): void {
	orchestratorPresence.delete(projectId);
}

export function invalidateCrossRepoLinksCache(projectId: string): void {
	crossRepoLinks.delete(projectId);
}

export function invalidateAllCrossRepoLinks(): void {
	crossRepoLinks.clear();
}

export function removeProjectEventsFile(projectId: string): void {
	try {
		rmSync(eventsFilePathForProject(projectId), { force: true });
	} catch {}
}

export function removeCrossRepoEventsFile(orchestratorId: string): void {
	try {
		rmSync(crossRepoEventsFilePath(orchestratorId), { force: true });
	} catch {}
}

export function attachOrchestratorEventSink(bus: EventBus): () => void {
	return bus.subscribeAll((projectId, ev) => {
		const line = `${JSON.stringify(ev)}\n`;

		try {
			if (projectHasOrchestrator(projectId)) {
				appendFileSync(eventsFilePathForProject(projectId), line, "utf-8");
			}
		} catch (err) {
			console.warn("[orchestrator-event-sink] per-repo write failed:", err);
			orchestratorPresence.delete(projectId);
		}

		try {
			const xros = crossRepoOrchestratorsForProject(projectId);
			let anyFailed = false;
			for (const xroId of xros) {
				try {
					appendFileSync(crossRepoEventsFilePath(xroId), line, "utf-8");
				} catch (err) {
					anyFailed = true;
					console.warn(`[orchestrator-event-sink] cross-repo write failed for ${xroId}:`, err);
				}
			}
			// Refresh the link cache only when something failed — the failure may be a
			// stale link (xro deleted) that the next lookup resolves.
			if (anyFailed) crossRepoLinks.delete(projectId);
		} catch (err) {
			console.warn("[orchestrator-event-sink] cross-repo lookup failed:", err);
			crossRepoLinks.delete(projectId);
		}
	});
}

function projectHasOrchestrator(projectId: string): boolean {
	const cached = orchestratorPresence.get(projectId);
	if (cached !== undefined) return cached;

	const row = getDb()
		.select({ id: workspaces.id })
		.from(workspaces)
		.where(and(eq(workspaces.projectId, projectId), eq(workspaces.isOrchestrator, true)))
		.get();

	const present = !!row;
	orchestratorPresence.set(projectId, present);
	return present;
}

function crossRepoOrchestratorsForProject(projectId: string): string[] {
	const cached = crossRepoLinks.get(projectId);
	if (cached !== undefined) return cached;

	const rows = getDb()
		.select({ orchestratorId: crossRepoOrchestratorProjects.orchestratorId })
		.from(crossRepoOrchestratorProjects)
		.where(eq(crossRepoOrchestratorProjects.projectId, projectId))
		.all();

	const ids = rows.map((r) => r.orchestratorId);
	crossRepoLinks.set(projectId, ids);
	return ids;
}
