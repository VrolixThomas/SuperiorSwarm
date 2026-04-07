import { and, eq, sql } from "drizzle-orm";
import type { CachedPR } from "../../shared/review-types";
import { getDb } from "../db";
import { type TrackedPr, projects, trackedPrs } from "../db/schema";
import { getConnectedGitProviders } from "../providers/git-provider";
import type { NormalizedPR } from "../providers/types";

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

function getProjectIdByRepo(owner: string, repoName: string): string {
	const db = getDb();

	// Fast indexed lookup first
	const exact = db
		.select({ id: projects.id })
		.from(projects)
		.where(and(eq(projects.remoteOwner, owner), eq(projects.remoteRepo, repoName)))
		.get();
	if (exact?.id) return exact.id;

	// Fallback: path-based matching
	const allProjects = db.select().from(projects).all();
	const needle = `${owner.toLowerCase()}/${repoName.toLowerCase()}`;
	const match = allProjects.find((p) => p.repoPath.toLowerCase().includes(needle));
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
		projectId: getProjectIdByRepo(pr.repoOwner, pr.repoName),
		role: pr.role,
		headCommitSha: pr.headCommitSha,
	};
}

// ── Core poll logic ────────────────────────────────────────────────────────────

async function fetchAllPRs(): Promise<{
	results: CachedPR[];
	successfulProviders: Set<string>;
}> {
	const results: CachedPR[] = [];
	const successfulProviders = new Set<string>();

	for (const provider of getConnectedGitProviders()) {
		try {
			const prs = await provider.getMyPRs();
			successfulProviders.add(provider.name);
			const seen = new Set<number>();
			for (const pr of prs) {
				if (!seen.has(pr.id)) {
					seen.add(pr.id);
					results.push(toCachedPR(pr, provider.name));
				}
			}
		} catch (err) {
			console.error(`[pr-poller] ${provider.name} fetch failed:`, err);
		}
	}

	// Enrich head commit SHA only for PRs whose listing fetch did NOT supply
	// it. Bitbucket now copies `source.commit.hash` straight from the listing
	// (Task 4) so this loop is GitHub-only after this change. Each call here
	// used to be 1 API request per open PR — eliminating the Bitbucket half
	// cuts ~100 calls per poll cycle.
	const openPRsNeedingEnrichment = results.filter((pr) => pr.state === "open" && !pr.headCommitSha);
	await Promise.allSettled(
		openPRsNeedingEnrichment.map(async (cachedPr) => {
			const provider = getConnectedGitProviders().find((p) => p.name === cachedPr.provider);
			if (!provider) return;
			const prState = await provider.getPRState(
				cachedPr.repoOwner,
				cachedPr.repoName,
				cachedPr.number
			);
			cachedPr.headCommitSha = prState.headSha;
		})
	);

	return { results, successfulProviders };
}

async function doPoll(): Promise<void> {
	let fetched: CachedPR[];
	let successfulProviders: Set<string>;
	try {
		const result = await fetchAllPRs();
		fetched = result.results;
		successfulProviders = result.successfulProviders;
	} catch (err) {
		console.error("[pr-poller] Poll failed:", err);
		return;
	}

	const db = getDb();

	// Collect events to fire after the transaction commits, so handlers see a
	// consistent table and we never fire on a rolled-back state.
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

		// Apply bootstrap-silent inserts.
		for (const pr of fetched) {
			if (!bootstrapSilentProviders.has(pr.provider)) continue;
			tx.insert(trackedPrs)
				.values(buildInsertRow(pr, now))
				.onConflictDoUpdate({
					target: [trackedPrs.provider, trackedPrs.identifier],
					set: buildUpdateSet(pr, now),
				})
				.run();
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

function buildUpdateSet(pr: CachedPR, now: Date): Partial<typeof trackedPrs.$inferInsert> {
	return {
		title: pr.title,
		state: pr.state,
		sourceBranch: pr.sourceBranch,
		targetBranch: pr.targetBranch,
		role: pr.role,
		headCommitSha: pr.headCommitSha || null,
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

// ── Public control API ─────────────────────────────────────────────────────────

export function startPolling(): void {
	if (pollTimer) return;

	console.log("[pr-poller] Starting background PR polling");
	// Run an initial poll immediately, then on interval
	doPoll().catch((err) => console.error("[pr-poller] Initial poll error:", err));
	pollTimer = setInterval(() => {
		doPoll().catch((err) => console.error("[pr-poller] Poll cycle error:", err));
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
	await doPoll();
}
