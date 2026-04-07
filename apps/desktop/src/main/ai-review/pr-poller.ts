import { and, eq } from "drizzle-orm";
import type { CachedPR } from "../../shared/review-types";
import { getDb } from "../db";
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

async function fetchAllPRs(): Promise<CachedPR[]> {
	const results: CachedPR[] = [];

	for (const provider of getConnectedGitProviders()) {
		try {
			const prs = await provider.getMyPRs();
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

	return results;
}

async function doPoll(): Promise<void> {
	let fetched: CachedPR[];
	try {
		fetched = await fetchAllPRs();
	} catch (err) {
		console.error("[pr-poller] Poll failed:", err);
		return;
	}

	const fetchedByIdentifier = new Map<string, CachedPR>();
	for (const pr of fetched) {
		fetchedByIdentifier.set(pr.identifier, pr);
	}

	// Detect new PRs (not in cache)
	for (const pr of fetched) {
		if (!prCache.has(pr.identifier)) {
			console.log(`[pr-poller] New PR detected: ${pr.identifier}`);
			onNewPRHandler?.(pr);
		}
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
		if (
			cached &&
			cached.headCommitSha &&
			pr.headCommitSha &&
			cached.headCommitSha !== pr.headCommitSha
		) {
			console.log(
				`[pr-poller] New commits on ${pr.identifier}: ${cached.headCommitSha} → ${pr.headCommitSha}`
			);
			onPRCommitChangedHandler?.(pr, cached.headCommitSha);
		}
	}

	// Update cache with latest data
	// Remove entries that are no longer fetched (PR disappeared entirely)
	for (const identifier of prCache.keys()) {
		if (!fetchedByIdentifier.has(identifier)) {
			prCache.delete(identifier);
		}
	}
	for (const pr of fetched) {
		prCache.set(pr.identifier, pr);
	}
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
