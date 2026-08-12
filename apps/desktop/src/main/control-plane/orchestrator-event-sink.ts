import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { and, eq, or } from "drizzle-orm";
import { getDb } from "../db";
import {
	crossRepoOrchestratorProjects,
	crossRepoOrchestrators,
	orchestratorMembers,
	workspaces,
} from "../db/schema";
import type { EventBus } from "./event-bus";
import type { CoordinationEvent } from "./event-bus";

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

// Per-project cache: which cross-repo orchestrator IDs can access this project?
const crossRepoLinks = new Map<string, string[]>(); // projectId → xro ids

interface JournalState {
	streamEpoch: string;
	nextSeq: number;
	inode: number | null;
	size: number;
}

const journalStates = new Map<string, JournalState>();

export function setEventsDir(dir: string): void {
	eventsDir = dir;
	journalStates.clear();
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
	const path = eventsFilePathForProject(projectId);
	try {
		rmSync(path, { force: true });
	} catch {}
	journalStates.delete(path);
}

export function removeCrossRepoEventsFile(orchestratorId: string): void {
	const path = crossRepoEventsFilePath(orchestratorId);
	try {
		rmSync(path, { force: true });
	} catch {}
	journalStates.delete(path);
}

function fileIdentity(path: string): { inode: number | null; size: number } | null {
	try {
		const stat = statSync(path);
		return { inode: typeof stat.ino === "number" ? stat.ino : null, size: stat.size };
	} catch {
		return null;
	}
}

function loadJournalState(path: string): JournalState {
	const identity = fileIdentity(path);
	if (!identity) {
		return { streamEpoch: randomUUID(), nextSeq: 0, inode: null, size: 0 };
	}
	let streamEpoch: string | null = null;
	let nextSeq = 0;
	try {
		for (const line of readFileSync(path, "utf-8").split("\n")) {
			if (!line.trim()) continue;
			try {
				const event = JSON.parse(line) as Record<string, unknown>;
				if (
					typeof event["streamEpoch"] === "string" &&
					typeof event["seq"] === "number" &&
					Number.isSafeInteger(event["seq"])
				) {
					if (streamEpoch !== event["streamEpoch"]) {
						streamEpoch = event["streamEpoch"];
						nextSeq = 0;
					}
					nextSeq = Math.max(nextSeq, event["seq"]);
				} else if (!streamEpoch) {
					nextSeq++;
				}
			} catch {
				// Preserve append-only recovery even if an older line is malformed.
			}
		}
	} catch {}
	return {
		streamEpoch: streamEpoch ?? randomUUID(),
		nextSeq,
		inode: identity.inode,
		size: identity.size,
	};
}

function journalState(path: string): JournalState {
	const current = fileIdentity(path);
	const cached = journalStates.get(path);
	if (cached && current && cached.inode === current.inode && current.size >= cached.size) {
		return cached;
	}
	const loaded = loadJournalState(path);
	// A replaced/truncated journal is a new stream even if its copied tail happened
	// to contain the old epoch. Clients must resnapshot instead of trusting offsets.
	if (cached && (!current || cached.inode !== current.inode || current.size < cached.size)) {
		loaded.streamEpoch = randomUUID();
		loaded.nextSeq = 0;
	}
	journalStates.set(path, loaded);
	return loaded;
}

function appendCoordinationEvent(
	path: string,
	projectId: string,
	eventId: string,
	ev: CoordinationEvent,
	ownedByRecipient?: boolean
): void {
	const state = journalState(path);
	state.nextSeq++;
	const envelope = {
		schemaVersion: 2 as const,
		streamEpoch: state.streamEpoch,
		seq: state.nextSeq,
		eventId,
		projectId,
		occurredAt: ev.ts,
		...(ownedByRecipient === undefined ? {} : { ownedByRecipient }),
		...ev,
	};
	appendFileSync(path, `${JSON.stringify(envelope)}\n`, "utf-8");
	const identity = fileIdentity(path);
	state.inode = identity?.inode ?? state.inode;
	state.size = identity?.size ?? state.size;
}

export function attachOrchestratorEventSink(bus: EventBus): () => void {
	return bus.subscribeAll((projectId, ev, metadata) => {
		const eventId = metadata.eventId;

		try {
			if (projectHasOrchestrator(projectId)) {
				appendCoordinationEvent(eventsFilePathForProject(projectId), projectId, eventId, ev);
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
					appendCoordinationEvent(
						crossRepoEventsFilePath(xroId),
						projectId,
						eventId,
						ev,
						eventOwnedByCrossRepoOrchestrator(xroId, ev)
					);
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

function eventOwnedByCrossRepoOrchestrator(orchestratorId: string, ev: CoordinationEvent): boolean {
	const workspaceIds =
		ev.event === "status"
			? [ev.workspaceId]
			: [ev.from, ev.to].filter((value): value is string => Boolean(value));
	if (workspaceIds.includes(orchestratorId)) return true;
	for (const workspaceId of workspaceIds) {
		const membership = getDb()
			.select({ workspaceId: orchestratorMembers.workspaceId })
			.from(orchestratorMembers)
			.where(
				and(
					eq(orchestratorMembers.orchestratorId, orchestratorId),
					eq(orchestratorMembers.parentKind, "cross_repo"),
					eq(orchestratorMembers.workspaceId, workspaceId)
				)
			)
			.get();
		if (membership) return true;
	}
	return false;
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
		.select({ orchestratorId: crossRepoOrchestrators.id })
		.from(crossRepoOrchestrators)
		.leftJoin(
			crossRepoOrchestratorProjects,
			eq(crossRepoOrchestratorProjects.orchestratorId, crossRepoOrchestrators.id)
		)
		.where(
			or(
				eq(crossRepoOrchestrators.accessScope, "all"),
				eq(crossRepoOrchestratorProjects.projectId, projectId)
			)
		)
		.all();

	const ids = [...new Set(rows.map((r) => r.orchestratorId))];
	crossRepoLinks.set(projectId, ids);
	return ids;
}
