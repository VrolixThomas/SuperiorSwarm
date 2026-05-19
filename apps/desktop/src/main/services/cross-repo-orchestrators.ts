import { app } from "electron";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { asc, eq, max } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "../db";
import { crossRepoOrchestrators, type CrossRepoOrchestrator } from "../db/schema";
import { invalidateAllCrossRepoLinks, removeCrossRepoEventsFile } from "../control-plane/orchestrator-event-sink";

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
