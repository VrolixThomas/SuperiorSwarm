import { and, eq, notInArray } from "drizzle-orm";
import type { JiraIssue } from "../atlassian/jira";
import { getDb } from "../db";
import { sessionState, teamMembers, ticketCache } from "../db/schema";
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

// ── Team members cache ──────────────────────────────────────────────────────

export interface CachedTeamMember {
	id: string;
	provider: "linear" | "jira";
	userId: string;
	name: string;
	email: string | null;
	avatarUrl: string | null;
	teamId: string;
}

export function getCachedTeamMembers(filter?: {
	provider?: "linear" | "jira";
	teamId?: string;
}): CachedTeamMember[] {
	const db = getDb();
	const conds = [];
	if (filter?.provider) conds.push(eq(teamMembers.provider, filter.provider));
	if (filter?.teamId) conds.push(eq(teamMembers.teamId, filter.teamId));
	if (conds.length === 0) return db.select().from(teamMembers).all();
	if (conds.length === 1) return db.select().from(teamMembers).where(conds[0]).all();
	return db
		.select()
		.from(teamMembers)
		.where(and(...conds))
		.all();
}

export function upsertTeamMembers(
	provider: "linear" | "jira",
	teamId: string,
	members: Array<{ userId: string; name: string; email: string | null; avatarUrl: string | null }>
): void {
	const db = getDb();

	const existing = db
		.select()
		.from(teamMembers)
		.where(and(eq(teamMembers.provider, provider), eq(teamMembers.teamId, teamId)))
		.all();

	const existingById = new Map(existing.map((r) => [r.id, r]));
	const incomingIds = new Set(members.map((m) => `${provider}:${teamId}:${m.userId}`));

	const toUpsert = members.filter((m) => {
		const row = existingById.get(`${provider}:${teamId}:${m.userId}`);
		if (!row) return true;
		return row.name !== m.name || row.email !== m.email || row.avatarUrl !== m.avatarUrl;
	});
	const toDelete = existing.filter((r) => !incomingIds.has(r.id)).map((r) => r.id);

	if (toUpsert.length === 0 && toDelete.length === 0) return;

	const now = new Date();
	db.transaction((tx) => {
		for (const member of toUpsert) {
			const id = `${provider}:${teamId}:${member.userId}`;
			tx.insert(teamMembers)
				.values({
					id,
					provider,
					userId: member.userId,
					name: member.name,
					email: member.email,
					avatarUrl: member.avatarUrl,
					teamId,
					updatedAt: now,
				})
				.onConflictDoUpdate({
					target: teamMembers.id,
					set: {
						name: member.name,
						email: member.email,
						avatarUrl: member.avatarUrl,
						teamId,
						updatedAt: now,
					},
				})
				.run();
		}

		if (toDelete.length > 0) {
			tx.delete(teamMembers)
				.where(
					and(
						eq(teamMembers.provider, provider),
						eq(teamMembers.teamId, teamId),
						notInArray(teamMembers.id, [...incomingIds])
					)
				)
				.run();
		}
	});
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

export function pruneOrphanTeamMembers(provider: "linear" | "jira", keepTeamIds: string[]): void {
	const db = getDb();
	if (keepTeamIds.length === 0) {
		db.delete(teamMembers).where(eq(teamMembers.provider, provider)).run();
		return;
	}
	db.delete(teamMembers)
		.where(and(eq(teamMembers.provider, provider), notInArray(teamMembers.teamId, keepTeamIds)))
		.run();
}

export function pruneOrphanTicketCache(provider: "linear" | "jira", keepGroupIds: string[]): void {
	const db = getDb();
	if (keepGroupIds.length === 0) {
		db.delete(ticketCache).where(eq(ticketCache.provider, provider)).run();
		return;
	}
	db.delete(ticketCache)
		.where(and(eq(ticketCache.provider, provider), notInArray(ticketCache.groupId, keepGroupIds)))
		.run();
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

// ── Assignee filter persistence ─────────────────────────────────────────────

const ASSIGNEE_FILTER_PREFIX = "tickets_assignee_filter_";

export function getAssigneeFilter(projectId: string): string | null {
	const db = getDb();
	const key = `${ASSIGNEE_FILTER_PREFIX}${projectId}`;
	const row = db.select().from(sessionState).where(eq(sessionState.key, key)).get();
	return row?.value ?? null;
}

export function setAssigneeFilter(projectId: string, value: string): void {
	const db = getDb();
	const key = `${ASSIGNEE_FILTER_PREFIX}${projectId}`;
	db.insert(sessionState)
		.values({ key, value })
		.onConflictDoUpdate({ target: sessionState.key, set: { value } })
		.run();
}

// ── Visible teams persistence ───────────────────────────────────────────────

const VISIBLE_TEAMS_KEY = "tickets_visible_teams";

function getVisibleTeams(): string | null {
	const db = getDb();
	const row = db.select().from(sessionState).where(eq(sessionState.key, VISIBLE_TEAMS_KEY)).get();
	return row?.value ?? null;
}

function setVisibleTeams(value: string): void {
	const db = getDb();
	db.insert(sessionState)
		.values({ key: VISIBLE_TEAMS_KEY, value })
		.onConflictDoUpdate({ target: sessionState.key, set: { value } })
		.run();
}

export function getVisibleTeamsTyped(): Array<{ provider: "linear" | "jira"; id: string }> | null {
	const raw = getVisibleTeams();
	if (raw === null || raw === "") return null;
	try {
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return null;
		return parsed.filter(
			(v): v is { provider: "linear" | "jira"; id: string } =>
				typeof v?.provider === "string" &&
				(v.provider === "linear" || v.provider === "jira") &&
				typeof v?.id === "string"
		);
	} catch {
		return null;
	}
}

export function setVisibleTeamsTyped(
	value: Array<{ provider: "linear" | "jira"; id: string }> | null
): void {
	setVisibleTeams(value === null ? "" : JSON.stringify(value));
}

// ── Known teams persistence ─────────────────────────────────────────────────
// Full list of teams/projects the user belongs to — fetched from providers during sync.
// Needed so TeamVisibilitySettings can show teams with zero issues (issue-derived lists
// would silently exclude them, and toggling one off would drop it from visibility forever).

const KNOWN_TEAMS_KEY = "tickets_known_teams";

export interface KnownTeam {
	provider: "linear" | "jira";
	id: string;
	name: string;
}

export function getKnownTeams(): KnownTeam[] {
	const db = getDb();
	const row = db.select().from(sessionState).where(eq(sessionState.key, KNOWN_TEAMS_KEY)).get();
	if (!row?.value) return [];
	try {
		const parsed = JSON.parse(row.value);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(
			(v): v is KnownTeam =>
				(v?.provider === "linear" || v?.provider === "jira") &&
				typeof v?.id === "string" &&
				typeof v?.name === "string"
		);
	} catch {
		return [];
	}
}

export function mergeKnownTeams(provider: "linear" | "jira", incoming: KnownTeam[]): void {
	if (incoming.length === 0) return;
	const db = getDb();
	const existing = getKnownTeams();
	const kept = existing.filter((t) => t.provider !== provider);
	const incomingSeen = new Set<string>();
	const deduped: KnownTeam[] = [];
	for (const t of incoming) {
		if (t.provider !== provider) continue;
		if (incomingSeen.has(t.id)) continue;
		incomingSeen.add(t.id);
		deduped.push(t);
	}
	const merged = [...kept, ...deduped];
	db.insert(sessionState)
		.values({ key: KNOWN_TEAMS_KEY, value: JSON.stringify(merged) })
		.onConflictDoUpdate({ target: sessionState.key, set: { value: JSON.stringify(merged) } })
		.run();
}
