import { appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { workspaces, worktrees } from "../db/schema";
import type { EventBus } from "./event-bus";

export const ORCHESTRATOR_EVENTS_FILENAME = ".ss-events.jsonl";

export function attachOrchestratorEventSink(bus: EventBus): () => void {
	return bus.subscribeAll((projectId, ev) => {
		try {
			const path = resolveOrchestratorEventsPath(projectId);
			if (!path) return;
			appendFileSync(path, `${JSON.stringify(ev)}\n`, "utf-8");
		} catch (err) {
			console.warn("[orchestrator-event-sink] write failed:", err);
		}
	});
}

function resolveOrchestratorEventsPath(projectId: string): string | null {
	const row = getDb()
		.select({ wtPath: worktrees.path })
		.from(workspaces)
		.leftJoin(worktrees, eq(workspaces.worktreeId, worktrees.id))
		.where(and(eq(workspaces.projectId, projectId), eq(workspaces.isOrchestrator, true)))
		.get();
	if (!row?.wtPath || !existsSync(row.wtPath)) return null;
	return join(row.wtPath, ORCHESTRATOR_EVENTS_FILENAME);
}
