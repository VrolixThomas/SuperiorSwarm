import type { CachedPR } from "../../shared/review-types";
import { getAuth as getBitbucketAuth } from "../atlassian/auth";
import { getMyPullRequests, getReviewRequests } from "../atlassian/bitbucket";
import { getDb } from "../db";
import { projects } from "../db/schema";
import { getValidToken } from "../github/auth";
import { getMyPRs } from "../github/github";

const POLL_INTERVAL_MS = 60_000;

// In-memory cache: identifier -> CachedPR
const prCache = new Map<string, CachedPR>();

let pollTimer: ReturnType<typeof setInterval> | null = null;
let onNewPRHandler: ((pr: CachedPR) => void) | null = null;
let onPRClosedHandler: ((pr: CachedPR) => void) | null = null;

// ── Public event registration ──────────────────────────────────────────────────

export function onNewPRDetected(handler: (pr: CachedPR) => void): void {
	onNewPRHandler = handler;
}

export function onPRClosedDetected(handler: (pr: CachedPR) => void): void {
	onPRClosedHandler = handler;
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

function getProjectIdForGitHub(owner: string, repo: string): string {
	const db = getDb();
	const allProjects = db.select().from(projects).all();
	const match = allProjects.find(
		(p) =>
			p.githubOwner?.toLowerCase() === owner.toLowerCase() &&
			p.githubRepo?.toLowerCase() === repo.toLowerCase()
	);
	return match?.id ?? "";
}

function getProjectIdForBitbucket(workspace: string, repoSlug: string): string {
	const db = getDb();
	const allProjects = db.select().from(projects).all();
	// Bitbucket repos are matched by parsing the remote URL of each project.
	// We do a best-effort match on repo path containing the workspace/repoSlug pattern.
	const match = allProjects.find((p) => {
		const path = p.repoPath.toLowerCase();
		return path.includes(`${workspace.toLowerCase()}/${repoSlug.toLowerCase()}`);
	});
	return match?.id ?? "";
}

// ── Mapping helpers ────────────────────────────────────────────────────────────

function mapGitHubPR(pr: Awaited<ReturnType<typeof getMyPRs>>[number]): CachedPR {
	const identifier = `${pr.repoOwner}/${pr.repoName}#${pr.number}`;
	// GitHubPR.state is "open" | "closed" — closed PRs may be merged; we can only tell
	// "closed" from the search API (merged PRs are excluded from open search).
	const state: CachedPR["state"] = pr.state === "open" ? "open" : "closed";

	return {
		provider: "github",
		identifier,
		number: pr.number,
		title: pr.title,
		state,
		sourceBranch: pr.branchName,
		targetBranch: "",
		author: { login: "", avatarUrl: "" },
		reviewers: [],
		ciStatus: null,
		commentCount: pr.commentCount,
		changedFiles: 0,
		additions: 0,
		deletions: 0,
		updatedAt: new Date().toISOString(),
		repoOwner: pr.repoOwner,
		repoName: pr.repoName,
		projectId: getProjectIdForGitHub(pr.repoOwner, pr.repoName),
		role: pr.role,
	};
}

function mapBitbucketPR(
	pr: Awaited<ReturnType<typeof getMyPullRequests>>[number],
	role: "author" | "reviewer",
): CachedPR {
	const identifier = `${pr.workspace}/${pr.repoSlug}#${pr.id}`;
	// Bitbucket states: OPEN, MERGED, DECLINED, SUPERSEDED
	const rawState = pr.state.toUpperCase();
	let state: CachedPR["state"] = "open";
	if (rawState === "MERGED") state = "merged";
	else if (rawState === "DECLINED" || rawState === "SUPERSEDED") state = "declined";
	else if (rawState !== "OPEN") state = "closed";

	return {
		provider: "bitbucket",
		identifier,
		number: pr.id,
		title: pr.title,
		state,
		sourceBranch: pr.source?.branch?.name ?? "",
		targetBranch: pr.destination?.branch?.name ?? "",
		author: { login: pr.author, avatarUrl: "" },
		reviewers: [],
		ciStatus: null,
		commentCount: pr.commentCount ?? 0,
		changedFiles: 0,
		additions: 0,
		deletions: 0,
		updatedAt: pr.updatedOn,
		repoOwner: pr.workspace,
		repoName: pr.repoSlug,
		projectId: getProjectIdForBitbucket(pr.workspace, pr.repoSlug),
		role,
	};
}

// ── Core poll logic ────────────────────────────────────────────────────────────

async function fetchAllPRs(): Promise<CachedPR[]> {
	const results: CachedPR[] = [];

	// GitHub
	if (getValidToken()) {
		try {
			const prs = await getMyPRs();
			for (const pr of prs) {
				results.push(mapGitHubPR(pr));
			}
		} catch (err) {
			console.error("[pr-poller] GitHub fetch failed:", err);
		}
	}

	// Bitbucket
	if (getBitbucketAuth("bitbucket")) {
		try {
			const [authored, reviewing] = await Promise.all([getMyPullRequests(), getReviewRequests()]);

			const seen = new Set<string>();
			for (const pr of authored) {
				const mapped = mapBitbucketPR(pr, "author");
				if (!seen.has(mapped.identifier)) {
					seen.add(mapped.identifier);
					results.push(mapped);
				}
			}
			for (const pr of reviewing) {
				const mapped = mapBitbucketPR(pr, "reviewer");
				if (!seen.has(mapped.identifier)) {
					seen.add(mapped.identifier);
					results.push(mapped);
				}
			}
		} catch (err) {
			console.error("[pr-poller] Bitbucket fetch failed:", err);
		}
	}

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
