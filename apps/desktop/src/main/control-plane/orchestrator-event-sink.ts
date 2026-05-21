import { appendFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { workspaces } from "../db/schema";
import type { EventBus } from "./event-bus";

// Per-project events live in <userData>/events/<projectId>.jsonl, outside
// the user's repo so they can never leak into `git status` or be committed.
// The orchestrator agent learns the absolute path through the superiorswarm
// MCP server's instructions (see mcp-standalone/server.mjs).

let eventsDir: string | null = null;

// Per-project cache: does this project currently have an orchestrator?
// true = write events, false = skip, undefined (missing key) = not yet cached.
const orchestratorPresence = new Map<string, boolean>();

export function setEventsDir(dir: string): void {
	eventsDir = dir;
	mkdirSync(dir, { recursive: true });
}

export function eventsFilePathForProject(projectId: string): string {
	if (!eventsDir) throw new Error("events dir not configured — call setEventsDir() at startup");
	return join(eventsDir, `${projectId}.jsonl`);
}

export function invalidateOrchestratorPresenceCache(projectId: string): void {
	orchestratorPresence.delete(projectId);
}

export function removeProjectEventsFile(projectId: string): void {
	try {
		rmSync(eventsFilePathForProject(projectId), { force: true });
	} catch {}
}

export function attachOrchestratorEventSink(bus: EventBus): () => void {
	return bus.subscribeAll((projectId, ev) => {
		try {
			if (!projectHasOrchestrator(projectId)) return;
			appendFileSync(eventsFilePathForProject(projectId), `${JSON.stringify(ev)}\n`, "utf-8");
		} catch (err) {
			console.warn("[orchestrator-event-sink] write failed:", err);
			orchestratorPresence.delete(projectId);
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
