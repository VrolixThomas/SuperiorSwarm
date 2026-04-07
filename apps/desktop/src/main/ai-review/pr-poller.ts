import { and, eq } from "drizzle-orm";
import type { CachedPR } from "../../shared/review-types";
import { getDb } from "../db";
import type { TrackedPr } from "../db/schema";
import { projects } from "../db/schema";
import { getConnectedGitProviders } from "../providers/git-provider";
import type { NormalizedPR } from "../providers/types";

const POLL_INTERVAL_MS = 60_000;

// In-memory cache: identifier -> CachedPR
const prCache = new Map<string, CachedPR>();

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
	const all = [...prCache.values()];
	if (projectId) {
		return all.filter((pr) => pr.projectId === projectId);
	}
	return all;
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

	// Enrich with head commit SHA (needed for commit change detection)
	const openPRs = results.filter((pr) => pr.state === "open");
	await Promise.allSettled(
		openPRs.map(async (cachedPr) => {
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

	const { newPRs, toDelete } = diffPRCache(prCache, fetched, successfulProviders);

	// Fire new-PR events
	for (const pr of newPRs) {
		console.log(`[pr-poller] New PR detected: ${pr.identifier}`);
		onNewPRHandler?.(pr);
	}

	// Detect closed/merged PRs (state changed to non-open)
	for (const pr of fetched) {
		if (pr.state !== "open") {
			const cached = prCache.get(pr.identifier);
			if (cached && cached.state === "open") {
				console.log(`[pr-poller] PR closed/merged: ${pr.identifier} (${pr.state})`);
				onPRClosedHandler?.(pr);
			}
		}
	}

	// Detect head commit changes on open PRs
	for (const pr of fetched) {
		if (pr.state !== "open") continue;
		const cached = prCache.get(pr.identifier);
		if (cached?.headCommitSha && pr.headCommitSha && cached.headCommitSha !== pr.headCommitSha) {
			console.log(
				`[pr-poller] New commits on ${pr.identifier}: ${cached.headCommitSha} → ${pr.headCommitSha}`
			);
			onPRCommitChangedHandler?.(pr, cached.headCommitSha);
		}
	}

	// Apply diff: prune stale entries, then upsert fetched.
	for (const identifier of toDelete) {
		prCache.delete(identifier);
	}
	for (const pr of fetched) {
		prCache.set(pr.identifier, pr);
	}
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

// ── Pure cache-diff helper (exported for testing) ─────────────────────────────

/**
 * Compute the new PRs and stale-cache deletions for a poll cycle.
 *
 * IMPORTANT: only deletes a cached entry if its OWNING provider was in the
 * `successfulProviders` set. If a provider's fetch failed (or returned nothing
 * for any other reason), all of that provider's cached entries are preserved
 * — otherwise the next successful poll would re-emit them as "new" and flood
 * the IPC channel. (This is the bug behind the 200+/burst flooding observed
 * in 2026-04-07 logs; see docs/superpowers/plans/2026-04-07-app-freeze-fix.md.)
 */
export function diffPRCache(
	cache: Map<string, CachedPR>,
	fetched: CachedPR[],
	successfulProviders: Set<string>
): { newPRs: CachedPR[]; toDelete: string[] } {
	const fetchedByIdentifier = new Map<string, CachedPR>();
	for (const pr of fetched) {
		fetchedByIdentifier.set(pr.identifier, pr);
	}

	const newPRs: CachedPR[] = [];
	for (const pr of fetched) {
		if (!cache.has(pr.identifier)) {
			newPRs.push(pr);
		}
	}

	const toDelete: string[] = [];
	for (const [identifier, cached] of cache) {
		if (!successfulProviders.has(cached.provider)) continue;
		if (!fetchedByIdentifier.has(identifier)) {
			toDelete.push(identifier);
		}
	}

	return { newPRs, toDelete };
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
