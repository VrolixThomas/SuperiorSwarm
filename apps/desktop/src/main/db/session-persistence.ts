import { eq, max, notInArray } from "drizzle-orm";
import type { SessionSaveData } from "../../shared/types";
import { getDb } from "./index";
import * as schema from "./schema";

export type { SessionSaveData };

const RENDERER_OWNED_SESSION_KEYS = new Set([
	"activeTabId",
	"activeWorkspaceId",
	"activeWorkspaceCwd",
	"diffMode",
	"baseBranchByWorkspace",
	"sidebarSegment",
	"activeWorkspaceBySegment",
	"selectedHermesSession",
	"hermesSessionPane",
	"workspaceMetadata",
	"activeTicketProject",
	"activeTicketScope",
	"expandedProjectIds",
	"vimMode",
	"notificationSounds",
]);

export function ensureTerminalSessionRow(input: {
	id: string;
	workspaceId: string;
	cwd: string;
	title?: string;
}): boolean {
	const db = getDb();
	const existing = db
		.select({ id: schema.terminalSessions.id })
		.from(schema.terminalSessions)
		.where(eq(schema.terminalSessions.id, input.id))
		.get();
	if (existing) return false;

	const sortOrder =
		(db
			.select({ value: max(schema.terminalSessions.sortOrder) })
			.from(schema.terminalSessions)
			.get()?.value ?? -1) + 1;
	const result = db
		.insert(schema.terminalSessions)
		.values({
			id: input.id,
			workspaceId: input.workspaceId,
			title: input.title ?? "Terminal",
			cwd: input.cwd,
			scrollback: null,
			sortOrder,
			updatedAt: new Date(),
		})
		.onConflictDoNothing()
		.run();
	return result.changes > 0;
}

export function savePaneLayouts(layouts: Record<string, string>): void {
	const db = getDb();
	const now = new Date();
	const workspaceIds = Object.keys(layouts);
	const existing = new Map(
		db
			.select({
				workspaceId: schema.paneLayouts.workspaceId,
				layout: schema.paneLayouts.layout,
			})
			.from(schema.paneLayouts)
			.all()
			.map((row) => [row.workspaceId, row.layout])
	);

	db.transaction((tx) => {
		if (workspaceIds.length > 0) {
			tx.delete(schema.paneLayouts)
				.where(notInArray(schema.paneLayouts.workspaceId, workspaceIds))
				.run();
		} else {
			tx.delete(schema.paneLayouts).run();
		}

		for (const [workspaceId, layoutJson] of Object.entries(layouts)) {
			if (existing.get(workspaceId) === layoutJson) continue;
			tx.insert(schema.paneLayouts)
				.values({ workspaceId, layout: layoutJson, updatedAt: now })
				.onConflictDoUpdate({
					target: schema.paneLayouts.workspaceId,
					set: { layout: layoutJson, updatedAt: now },
				})
				.run();
		}
	});
}

export function saveTerminalSessions(data: SessionSaveData): void {
	const db = getDb();
	const now = new Date();
	const currentIds = data.sessions.map((s) => s.id);
	const existingSessions = new Map(
		db
			.select({
				id: schema.terminalSessions.id,
				workspaceId: schema.terminalSessions.workspaceId,
				title: schema.terminalSessions.title,
				cwd: schema.terminalSessions.cwd,
				sortOrder: schema.terminalSessions.sortOrder,
			})
			.from(schema.terminalSessions)
			.all()
			.map((row) => [row.id, row])
	);
	const existingState = new Map(
		db
			.select({ key: schema.sessionState.key, value: schema.sessionState.value })
			.from(schema.sessionState)
			.all()
			.map((row) => [row.key, row.value])
	);

	db.transaction((tx) => {
		// Delete sessions no longer open
		if (currentIds.length > 0) {
			tx.delete(schema.terminalSessions)
				.where(notInArray(schema.terminalSessions.id, currentIds))
				.run();
		} else {
			tx.delete(schema.terminalSessions).run();
		}

		// Insert or update changed session metadata. `updated_at` is deliberately
		// left untouched on updates: the daemon owns it as the last-output timestamp.
		for (const session of data.sessions) {
			const existing = existingSessions.get(session.id);
			if (!existing) {
				tx.insert(schema.terminalSessions)
					.values({
						id: session.id,
						workspaceId: session.workspaceId,
						title: session.title,
						cwd: session.cwd,
						scrollback: null,
						sortOrder: session.sortOrder,
						updatedAt: now,
					})
					.run();
				continue;
			}

			if (
				existing.workspaceId === session.workspaceId &&
				existing.title === session.title &&
				existing.cwd === session.cwd &&
				existing.sortOrder === session.sortOrder
			) {
				continue;
			}

			tx.update(schema.terminalSessions)
				.set({
					workspaceId: session.workspaceId,
					title: session.title,
					cwd: session.cwd,
					sortOrder: session.sortOrder,
				})
				.where(eq(schema.terminalSessions.id, session.id))
				.run();
		}

		// Diff only keys this snapshot actually owns. Ticket integrations and other
		// main-process features persist preferences in the same table.
		for (const key of existingState.keys()) {
			if (RENDERER_OWNED_SESSION_KEYS.has(key) && !(key in data.state)) {
				tx.delete(schema.sessionState).where(eq(schema.sessionState.key, key)).run();
			}
		}
		for (const [key, value] of Object.entries(data.state)) {
			if (existingState.get(key) === value) continue;
			tx.insert(schema.sessionState)
				.values({ key, value })
				.onConflictDoUpdate({
					target: schema.sessionState.key,
					set: { value },
				})
				.run();
		}
	});
}
