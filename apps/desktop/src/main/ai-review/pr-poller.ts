import { and, eq, sql } from "drizzle-orm";
import type { CachedPR } from "../../shared/review-types";
import { observePRPoll } from "../activity-queue/pr-source";
import { getDb } from "../db";
import { type TrackedPr, projects, reviewDrafts, trackedPrs } from "../db/schema";
import { getConnectedGitProviders } from "../providers/git-provider";
import { type PRActivityFacts, prIdentity } from "../providers/pr-activity";
import type { NormalizedPR } from "../providers/types";
import { PRConfirmationBudget, coalescePoll } from "./pr-poll-cycle";

const POLL_INTERVAL_MS = 60_000;

let pollTimer: ReturnType<typeof setInterval> | null = null;
let onNewPRHandler: ((pr: CachedPR) => void) | null = null;
let onPRClosedHandler: ((pr: CachedPR) => void) | null = null;
let onPRCommitChangedHandler: ((pr: CachedPR, previousSha: string) => void) | null = null;

// ── Public event registration ──────────────────────────────────────────────────

export function onNewPRDetected(handler: (pr: CachedPR) => void): void {
	onNewPRHandler = handler;
}

export function onPRClosedDetected(handler: (pr: CachedPR) => void): void {
	onPRClosedHandler = handler;
}

export function onPRCommitChanged(handler: (pr: CachedPR, previousSha: string) => void): void {
	onPRCommitChangedHandler = handler;
}

// ── Cache access ───────────────────────────────────────────────────────────────

export function getCachedPRs(projectId?: string): CachedPR[] {
	const db = getDb();
	const rows = projectId
		? db.select().from(trackedPrs).where(eq(trackedPrs.projectId, projectId)).all()
		: db.select().from(trackedPrs).all();
	return rows.map(rowToCachedPR);
}

// ── Project lookup helpers ─────────────────────────────────────────────────────

function getProjectIdByRepo(provider: string, owner: string, repoName: string): string {
	const db = getDb();
	const host = provider === "bitbucket" ? "bitbucket.org" : "github.com";

	// Fast indexed lookup first
	const exact = db
		.select({ id: projects.id })
		.from(projects)
		.where(
			and(
				eq(projects.remoteOwner, owner),
				eq(projects.remoteRepo, repoName),
				eq(projects.remoteHost, host)
			)
		)
		.get();
	if (exact?.id) return exact.id;

	// Fallback: path-based matching
	const allProjects = db.select().from(projects).all();
	const needle = `${owner.toLowerCase()}/${repoName.toLowerCase()}`;
	const match = allProjects.find(
		(p) => p.remoteHost === host && p.repoPath.toLowerCase().includes(needle)
	);
	return match?.id ?? "";
}

// ── Mapping helpers ────────────────────────────────────────────────────────────

function toCachedPR(pr: NormalizedPR, provider: string): CachedPR {
	const identifier = `${pr.repoOwner}/${pr.repoName}#${pr.id}`;
	return {
		provider: provider as CachedPR["provider"],
		identifier,
		number: pr.id,
		title: pr.title,
		state: pr.state === "declined" ? "declined" : pr.state,
		sourceBranch: pr.sourceBranch,
		targetBranch: pr.targetBranch,
		author: { login: pr.author, avatarUrl: "" },
		reviewers: [],
		ciStatus: null,
		commentCount: 0,
		changedFiles: 0,
		additions: 0,
		deletions: 0,
		updatedAt: new Date().toISOString(),
		repoOwner: pr.repoOwner,
		repoName: pr.repoName,
		projectId: getProjectIdByRepo(provider, pr.repoOwner, pr.repoName),
		role: pr.role,
		headCommitSha: pr.headCommitSha,
	};
}

// ── Core poll logic ────────────────────────────────────────────────────────────

const confirmationBudget = new PRConfirmationBudget();

export function deduplicatePRs(prs: NormalizedPR[]): NormalizedPR[] {
	return [...new Map(prs.map((pr) => [`${pr.repoOwner}/${pr.repoName}#${pr.id}`, pr])).values()];
}

async function fetchAllPRs(): Promise<{
	results: CachedPR[];
	successfulProviders: Set<string>;
	observations: Map<string, PRActivityFacts>;
	errors: Map<string, string>;
}> {
	const results: CachedPR[] = [];
	const successfulProviders = new Set<string>();
	const observations = new Map<string, PRActivityFacts>();
	const errors = new Map<string, string>();
	const providers = getConnectedGitProviders();
	const existing = getCachedPRs();
	// A manually-created ready review can exist outside authored/requested listings.
	const localDraftPRs = getDb()
		.select()
		.from(reviewDrafts)
		.where(eq(reviewDrafts.status, "ready"))
		.all()
		.flatMap((draft) => {
			const match = /^([^/]+)\/([^#]+)#(\d+)$/.exec(draft.prIdentifier);
			if (!match || (draft.prProvider !== "github" && draft.prProvider !== "bitbucket")) return [];
			return [
				toCachedPR(
					{
						id: Number(match[3]),
						repoOwner: match[1] ?? "",
						repoName: match[2] ?? "",
						title: draft.prTitle,
						author: draft.prAuthor,
						sourceBranch: draft.sourceBranch,
						targetBranch: draft.targetBranch,
						headCommitSha: "",
						role: "reviewer",
						state: "open",
						webUrl: "",
					},
					draft.prProvider
				),
			];
		});
	await Promise.all(
		providers.map(async (provider) => {
			try {
				const prs = deduplicatePRs(await provider.getMyPRs());
				successfulProviders.add(provider.name);
				for (const pr of prs) {
					results.push(toCachedPR(pr, provider.name));
					observations.set(
						prIdentity(provider.name, pr.repoOwner, pr.repoName, pr.id),
						pr.activity ?? {}
					);
				}
			} catch (error) {
				console.error(`[pr-poller] ${provider.name} fetch failed:`, error);
				for (const pr of existing.filter((p) => p.provider === provider.name))
					errors.set(
						prIdentity(pr.provider, pr.repoOwner, pr.repoName, pr.number),
						"PR provider fetch failed"
					);
			}
		})
	);
	const key = (pr: CachedPR) => prIdentity(pr.provider, pr.repoOwner, pr.repoName, pr.number);
	const byKey = new Map(results.map((pr) => [key(pr), pr]));
	const checkable = new Map(
		[...localDraftPRs, ...existing.filter((pr) => pr.state === "open"), ...byKey.values()].map(
			(pr) => [key(pr), pr]
		)
	);
	const candidates = [...checkable.values()]
		.filter((pr) => {
			if (!successfulProviders.has(pr.provider)) return false;
			const facts = observations.get(key(pr));
			return (
				!facts ||
				!facts.headSha ||
				facts.isDraft === undefined ||
				facts.reviewRequested === undefined
			);
		})
		.map((pr) => ({ key: key(pr), pr }));
	await confirmationBudget.run(candidates, async ({ key, pr }) => {
		try {
			const provider = providers.find((p) => p.name === pr.provider);
			if (!provider) throw new Error("PR provider disconnected");
			const state = await provider.getPRState(pr.repoOwner, pr.repoName, pr.number);
			const facts = {
				...observations.get(key),
				...state.activity,
				state: state.state,
				...(state.headSha ? { headSha: state.headSha } : {}),
			};
			observations.set(key, facts);
			const current = byKey.get(key);
			if (current) {
				current.state = state.state;
				if (state.headSha) current.headCommitSha = state.headSha;
			} else {
				const confirmed = {
					...pr,
					state: state.state,
					headCommitSha: state.headSha || pr.headCommitSha,
				};
				results.push(confirmed);
				byKey.set(key, confirmed);
			}
		} catch (error) {
			errors.set(key, "PR confirmation failed; previous state retained");
			throw error;
		}
	});
	return { results, successfulProviders, observations, errors };
}

async function doPoll(): Promise<void> {
	let fetched: CachedPR[];
	let successfulProviders: Set<string>;
	let observations: Map<string, PRActivityFacts>;
	let errors: Map<string, string>;
	try {
		const result = await fetchAllPRs();
		fetched = result.results;
		successfulProviders = result.successfulProviders;
		observations = result.observations;
		errors = result.errors;
	} catch (err) {
		console.error("[pr-poller] Poll failed:", err);
		return;
	}

	const db = getDb();

	// Collect events to fire AFTER the transaction commits, so handlers see a
	// consistent table and we never fire on a rolled-back state. Important
	// invariant: better-sqlite3's `db.transaction(callback)` does NOT retry the
	// callback on errors — a thrown exception propagates out of `db.transaction`
	// and unwinds `doPoll` entirely, skipping the firing loops below. The
	// `*ToEmit` arrays may therefore be partially populated when a rollback
	// occurs, but their contents are simply discarded with the stack frame.
	// If you ever wrap the transaction in a try/catch that recovers, you MUST
	// also clear these arrays before continuing or you will fire events for
	// rolled-back rows.
	const newPRsToEmit: CachedPR[] = [];
	const closedPRsToEmit: CachedPR[] = [];
	const commitChangedToEmit: { pr: CachedPR; previousSha: string }[] = [];

	db.transaction((tx) => {
		// Per-provider bootstrap-silent: the first time a provider's poll
		// succeeds while we have zero rows for it, insert all its fetched PRs
		// silently (no events). Handles both "new user connects providers one
		// at a time" and "existing user upgrades to the new schema" without
		// firing 200 spurious auto-trigger events.
		const bootstrapSilentProviders = new Set<string>();
		for (const provider of successfulProviders) {
			const countRow = tx
				.select({ c: sql<number>`COUNT(*)` })
				.from(trackedPrs)
				.where(eq(trackedPrs.provider, provider))
				.get();
			if ((countRow?.c ?? 0) === 0) {
				bootstrapSilentProviders.add(provider);
			}
		}

		// Load existing rows for diffing (only for providers in the normal path).
		const existingRows: TrackedPr[] = [];
		for (const provider of successfulProviders) {
			if (bootstrapSilentProviders.has(provider)) continue;
			const rows = tx.select().from(trackedPrs).where(eq(trackedPrs.provider, provider)).all();
			for (const r of rows) existingRows.push(r);
		}

		// Compute the diff for the non-bootstrap providers.
		const diffInputFetched = fetched.filter((pr) => !bootstrapSilentProviders.has(pr.provider));
		const diffInputSuccess = new Set(
			[...successfulProviders].filter((p) => !bootstrapSilentProviders.has(p))
		);
		const diff = diffTrackedPrs({
			existingRows,
			fetched: diffInputFetched,
			successfulProviders: diffInputSuccess,
		});

		const now = new Date();

		// Apply bootstrap-silent inserts. Use onConflictDoNothing (not Update) so
		// that if a row somehow already exists for this (provider, identifier) —
		// e.g. from a concurrent process or a partially-applied prior poll — we
		// leave it alone rather than silently overwriting it without firing events.
		// The next poll cycle (when this provider is no longer in bootstrap mode)
		// will catch any genuine state changes via the normal diff path.
		for (const pr of fetched) {
			if (!bootstrapSilentProviders.has(pr.provider)) continue;
			tx.insert(trackedPrs).values(buildInsertRow(pr, now)).onConflictDoNothing().run();
		}

		// Track newPRs to emit AFTER commit.
		for (const pr of diff.newPRs) {
			newPRsToEmit.push(pr);
		}

		// Apply normal-path upserts: every fetched PR for a non-bootstrap
		// provider gets its row updated (or inserted if missing — the
		// onConflictDoUpdate handles both new PRs and races).
		for (const pr of diffInputFetched) {
			tx.insert(trackedPrs)
				.values(buildInsertRow(pr, now))
				.onConflictDoUpdate({
					target: [trackedPrs.provider, trackedPrs.identifier],
					set: buildUpdateSet(pr, now),
				})
				.run();
		}

		// Update state_changed_at for closed PRs.
		for (const pr of diff.closedPRs) {
			tx.update(trackedPrs)
				.set({ stateChangedAt: now, updatedAt: now })
				.where(and(eq(trackedPrs.provider, pr.provider), eq(trackedPrs.identifier, pr.identifier)))
				.run();
			closedPRsToEmit.push(pr);
		}

		for (const c of diff.commitChangedPRs) {
			commitChangedToEmit.push(c);
		}
	});

	// Queue baselines are persisted only after tracked PR persistence succeeds.
	try {
		observePRPoll(getCachedPRs(), observations, errors);
	} catch (error) {
		console.error("[pr-poller] Queue projection failed:", error);
	}

	// Fire events AFTER the transaction commits.
	for (const pr of newPRsToEmit) {
		console.log(`[pr-poller] New PR detected: ${pr.identifier}`);
		onNewPRHandler?.(pr);
	}
	for (const pr of closedPRsToEmit) {
		console.log(`[pr-poller] PR closed/merged: ${pr.identifier} (${pr.state})`);
		onPRClosedHandler?.(pr);
	}
	for (const c of commitChangedToEmit) {
		console.log(
			`[pr-poller] New commits on ${c.pr.identifier}: ${c.previousSha} → ${c.pr.headCommitSha}`
		);
		onPRCommitChangedHandler?.(c.pr, c.previousSha);
	}
}

function buildInsertRow(pr: CachedPR, now: Date): typeof trackedPrs.$inferInsert {
	return {
		provider: pr.provider,
		identifier: pr.identifier,
		repoOwner: pr.repoOwner,
		repoName: pr.repoName,
		number: pr.number,
		projectId: pr.projectId || null,
		title: pr.title,
		state: pr.state,
		sourceBranch: pr.sourceBranch,
		targetBranch: pr.targetBranch,
		role: pr.role,
		headCommitSha: pr.headCommitSha || null,
		authorLogin: pr.author.login,
		authorAvatarUrl: pr.author.avatarUrl || null,
		firstSeenAt: now,
		lastSeenAt: now,
		stateChangedAt: null,
		updatedAt: now,
		autoReviewFirstTriggeredAt: null,
		autoReviewLastTriggeredSha: null,
	};
}

/**
 * Drizzle conflict-resolution payload for an UPSERT against `tracked_prs`.
 *
 * IMPORTANT: this set deliberately OMITS `firstSeenAt` so that updating an
 * existing row preserves its original first-seen timestamp. The asymmetry
 * with `buildInsertRow` (which DOES set `firstSeenAt`) is load-bearing — do
 * NOT add `firstSeenAt` here without changing the semantics intentionally.
 */
export function buildUpdateSet(pr: CachedPR, now: Date): Partial<typeof trackedPrs.$inferInsert> {
	return {
		title: pr.title,
		state: pr.state,
		sourceBranch: pr.sourceBranch,
		targetBranch: pr.targetBranch,
		role: pr.role,
		...(pr.headCommitSha ? { headCommitSha: pr.headCommitSha } : {}),
		authorLogin: pr.author.login,
		authorAvatarUrl: pr.author.avatarUrl || null,
		projectId: pr.projectId || null,
		lastSeenAt: now,
		updatedAt: now,
	};
}

// ── Pure DB-row → CachedPR mapper (exported for testing) ──────────────────────

/**
 * Convert a `tracked_prs` row into the `CachedPR` shape the renderer and the
 * workspaces / comment-poller / create-and-queue-solve consumers already
 * expect. The placeholder fields (`reviewers`, `commentCount`, etc.) are
 * hardcoded to match the in-memory `toCachedPR` they're replacing — those
 * fields were never populated by the poller in the first place.
 */
export function rowToCachedPR(row: TrackedPr): CachedPR {
	return {
		provider: row.provider as CachedPR["provider"],
		identifier: row.identifier,
		number: row.number,
		title: row.title,
		state: row.state as CachedPR["state"],
		sourceBranch: row.sourceBranch,
		targetBranch: row.targetBranch,
		author: { login: row.authorLogin, avatarUrl: row.authorAvatarUrl ?? "" },
		reviewers: [],
		ciStatus: null,
		commentCount: 0,
		changedFiles: 0,
		additions: 0,
		deletions: 0,
		updatedAt: row.updatedAt.toISOString(),
		repoOwner: row.repoOwner,
		repoName: row.repoName,
		projectId: row.projectId ?? "",
		role: row.role as CachedPR["role"],
		headCommitSha: row.headCommitSha ?? "",
	};
}

// ── Pure tracked-prs diff helper (exported for testing) ──────────────────────

export interface DiffTrackedPrsArgs {
	existingRows: TrackedPr[];
	fetched: CachedPR[];
	successfulProviders: Set<string>;
}

export interface DiffTrackedPrsResult {
	newPRs: CachedPR[];
	closedPRs: CachedPR[];
	commitChangedPRs: { pr: CachedPR; previousSha: string }[];
}

/**
 * Compute new / closed / commit-changed lists for a poll cycle, given the
 * existing `tracked_prs` rows and the freshly fetched PRs. Pure function.
 *
 * Only fetched PRs whose provider is in `successfulProviders` participate in
 * the diff — this matches the per-provider partial-failure semantics from the
 * `diffPRCache` fix and prevents the new-PR flood when one provider's listing
 * call transiently fails.
 *
 * `newPRs`            — fetched PRs whose (provider, identifier) is not in existingRows
 * `closedPRs`         — fetched PRs whose row exists with state="open" but the fetch
 *                       returned a non-open state (state-flip detection)
 * `commitChangedPRs`  — fetched PRs whose row's headCommitSha differs from the
 *                       fetched headCommitSha (both must be non-null/non-empty)
 *
 * Rows whose provider succeeded but did NOT appear in the fetched set are
 * intentionally left untouched — see the spec for the "PR disappears from
 * listing" handling.
 */
export function diffTrackedPrs(args: DiffTrackedPrsArgs): DiffTrackedPrsResult {
	const { existingRows, fetched, successfulProviders } = args;

	const rowByKey = new Map<string, TrackedPr>();
	for (const row of existingRows) {
		rowByKey.set(`${row.provider}:${row.identifier}`, row);
	}

	const newPRs: CachedPR[] = [];
	const closedPRs: CachedPR[] = [];
	const commitChangedPRs: { pr: CachedPR; previousSha: string }[] = [];

	for (const pr of fetched) {
		if (!successfulProviders.has(pr.provider)) continue;
		const key = `${pr.provider}:${pr.identifier}`;
		const row = rowByKey.get(key);

		if (!row) {
			newPRs.push(pr);
			continue;
		}

		if (row.state === "open" && pr.state !== "open") {
			closedPRs.push(pr);
		}

		if (row.headCommitSha && pr.headCommitSha && row.headCommitSha !== pr.headCommitSha) {
			commitChangedPRs.push({ pr, previousSha: row.headCommitSha });
		}
	}

	return { newPRs, closedPRs, commitChangedPRs };
}

const poll = coalescePoll(doPoll);

// ── Public control API ─────────────────────────────────────────────────────────

export function startPolling(): void {
	if (pollTimer) return;

	console.log("[pr-poller] Starting background PR polling");
	// Run an initial poll immediately, then on interval
	poll().catch((err) => console.error("[pr-poller] Initial poll error:", err));
	pollTimer = setInterval(() => {
		poll().catch((err) => console.error("[pr-poller] Poll cycle error:", err));
	}, POLL_INTERVAL_MS);
}

export function stopPolling(): void {
	if (pollTimer) {
		clearInterval(pollTimer);
		pollTimer = null;
		console.log("[pr-poller] Stopped");
	}
}

export async function refreshNow(): Promise<void> {
	await poll();
}
