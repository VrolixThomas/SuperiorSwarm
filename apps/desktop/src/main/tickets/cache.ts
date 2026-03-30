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

function upsertAndPrune(
	provider: "jira" | "linear",
	entries: { id: string; data: string; groupId: string }[]
): void {
	const db = getDb();
	const now = new Date();

	db.transaction((tx) => {
		const currentIds: string[] = [];

		for (const entry of entries) {
			currentIds.push(entry.id);
			tx.insert(ticketCache)
				.values({
					id: entry.id,
					provider,
					data: entry.data,
					groupId: entry.groupId,
					updatedAt: now,
				})
				.onConflictDoUpdate({
					target: ticketCache.id,
					set: { data: entry.data, groupId: entry.groupId, updatedAt: now },
				})
				.run();
		}

		if (currentIds.length > 0) {
			tx.delete(ticketCache)
				.where(and(eq(ticketCache.provider, provider), notInArray(ticketCache.id, currentIds)))
				.run();
		} else {
			tx.delete(ticketCache).where(eq(ticketCache.provider, provider)).run();
		}
	});
}

export function upsertJiraIssues(issues: JiraIssue[]): void {
	upsertAndPrune(
		"jira",
		issues.map((issue) => ({
			id: `jira:${issue.key}`,
			data: JSON.stringify(issue),
			groupId: issue.projectKey,
		}))
	);
}

export function upsertLinearIssues(issues: LinearIssue[]): void {
	upsertAndPrune(
		"linear",
		issues.map((issue) => ({
			id: `linear:${issue.id}`,
			data: JSON.stringify(issue),
			groupId: issue.teamId,
		}))
	);
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
