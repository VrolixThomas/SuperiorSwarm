// apps/desktop/src/main/tickets/cache.ts
import { and, eq, notInArray } from "drizzle-orm";
import type { JiraIssue } from "../atlassian/jira";
import { getDb } from "../db";
import { sessionState, ticketCache } from "../db/schema";
import type { LinearIssue } from "../linear/linear";

const LAST_FETCHED_KEY = "tickets_last_fetched";
const DONE_CUTOFF_KEY = "tickets_done_cutoff_days";

// ── Cache read ───────────────────────────────────────────────────────────────

export function getCachedJiraIssues(): JiraIssue[] {
	const db = getDb();
	const rows = db.select().from(ticketCache).where(eq(ticketCache.provider, "jira")).all();
	return rows.map((r) => JSON.parse(r.data) as JiraIssue);
}

export function getCachedLinearIssues(): LinearIssue[] {
	const db = getDb();
	const rows = db.select().from(ticketCache).where(eq(ticketCache.provider, "linear")).all();
	return rows.map((r) => JSON.parse(r.data) as LinearIssue);
}

// ── Cache write ──────────────────────────────────────────────────────────────

export function upsertJiraIssues(issues: JiraIssue[]): void {
	const db = getDb();
	const now = new Date();
	const currentIds: string[] = [];

	for (const issue of issues) {
		const id = `jira:${issue.key}`;
		currentIds.push(id);
		db.insert(ticketCache)
			.values({
				id,
				provider: "jira",
				data: JSON.stringify(issue),
				groupId: issue.projectKey,
				updatedAt: now,
			})
			.onConflictDoUpdate({
				target: ticketCache.id,
				set: {
					data: JSON.stringify(issue),
					groupId: issue.projectKey,
					updatedAt: now,
				},
			})
			.run();
	}

	// Prune tickets no longer returned by the API
	if (currentIds.length > 0) {
		db.delete(ticketCache)
			.where(and(eq(ticketCache.provider, "jira"), notInArray(ticketCache.id, currentIds)))
			.run();
	} else {
		db.delete(ticketCache).where(eq(ticketCache.provider, "jira")).run();
	}
}

export function upsertLinearIssues(issues: LinearIssue[]): void {
	const db = getDb();
	const now = new Date();
	const currentIds: string[] = [];

	for (const issue of issues) {
		const id = `linear:${issue.id}`;
		currentIds.push(id);
		db.insert(ticketCache)
			.values({
				id,
				provider: "linear",
				data: JSON.stringify(issue),
				groupId: issue.teamId,
				updatedAt: now,
			})
			.onConflictDoUpdate({
				target: ticketCache.id,
				set: {
					data: JSON.stringify(issue),
					groupId: issue.teamId,
					updatedAt: now,
				},
			})
			.run();
	}

	if (currentIds.length > 0) {
		db.delete(ticketCache)
			.where(and(eq(ticketCache.provider, "linear"), notInArray(ticketCache.id, currentIds)))
			.run();
	} else {
		db.delete(ticketCache).where(eq(ticketCache.provider, "linear")).run();
	}
}

// ── Last-fetched timestamp ───────────────────────────────────────────────────

export function getLastFetched(): string | null {
	const db = getDb();
	const row = db.select().from(sessionState).where(eq(sessionState.key, LAST_FETCHED_KEY)).get();
	return row?.value ?? null;
}

export function setLastFetched(): void {
	const db = getDb();
	const value = new Date().toISOString();
	db.insert(sessionState)
		.values({ key: LAST_FETCHED_KEY, value })
		.onConflictDoUpdate({
			target: sessionState.key,
			set: { value },
		})
		.run();
}

// ── Done cutoff days ─────────────────────────────────────────────────────────

export function getDoneCutoffDays(): number {
	const db = getDb();
	const row = db.select().from(sessionState).where(eq(sessionState.key, DONE_CUTOFF_KEY)).get();
	const parsed = Number(row?.value);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 14;
}

export function setDoneCutoffDays(days: number): void {
	const db = getDb();
	db.insert(sessionState)
		.values({ key: DONE_CUTOFF_KEY, value: String(days) })
		.onConflictDoUpdate({
			target: sessionState.key,
			set: { value: String(days) },
		})
		.run();
}
