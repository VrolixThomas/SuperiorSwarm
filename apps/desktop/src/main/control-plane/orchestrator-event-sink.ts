import { appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { workspaces, worktrees } from "../db/schema";
import type { EventBus } from "./event-bus";

export const ORCHESTRATOR_EVENTS_FILENAME = ".ss-events.jsonl";

// Per-project cache of the orchestrator's events file path.
// null = looked up, no orchestrator found. undefined (missing key) = not yet cached.
const pathCache = new Map<string, string | null>();

export function invalidateOrchestratorPathCache(projectId: string): void {
	pathCache.delete(projectId);
}

export function attachOrchestratorEventSink(bus: EventBus): () => void {
	return bus.subscribeAll((projectId, ev) => {
		try {
			const path = resolveOrchestratorEventsPath(projectId);
			if (!path) return;
			appendFileSync(path, `${JSON.stringify(ev)}\n`, "utf-8");
		} catch (err) {
			console.warn("[orchestrator-event-sink] write failed:", err);
			// Invalidate on write failure — orchestrator may have moved.
			pathCache.delete(projectId);
		}
	});
}

function resolveOrchestratorEventsPath(projectId: string): string | null {
	if (pathCache.has(projectId)) return pathCache.get(projectId) ?? null;

	const row = getDb()
		.select({ wtPath: worktrees.path })
		.from(workspaces)
		.leftJoin(worktrees, eq(workspaces.worktreeId, worktrees.id))
		.where(and(eq(workspaces.projectId, projectId), eq(workspaces.isOrchestrator, true)))
		.get();

	const resolved =
		row?.wtPath && existsSync(row.wtPath) ? join(row.wtPath, ORCHESTRATOR_EVENTS_FILENAME) : null;

	pathCache.set(projectId, resolved);
	return resolved;
}
