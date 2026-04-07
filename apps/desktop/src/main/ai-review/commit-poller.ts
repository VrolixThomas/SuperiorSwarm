import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import * as schema from "../db/schema";
import { getGitProvider } from "../providers/git-provider";
import { cleanupReviewWorkspace, findReviewWorkspaceByPR } from "./cleanup";
import { getSettings, queueFollowUpReview } from "./orchestrator";
import { parsePrIdentifier } from "./pr-identifier";

const POLL_INTERVAL_MS = 60_000;

interface WatchedChain {
	reviewChainId: string;
	prProvider: string;
	prIdentifier: string;
	lastKnownSha: string;
}

type NewCommitsHandler = (event: {
	reviewChainId: string;
	prIdentifier: string;
	oldSha: string;
	newSha: string;
}) => void;

let pollTimer: ReturnType<typeof setInterval> | null = null;
let onNewCommitsHandler: NewCommitsHandler | null = null;

function getActiveChains(): WatchedChain[] {
	const db = getDb();

	const allDrafts = db.select().from(schema.reviewDrafts).all();

	const chainMap = new Map<string, typeof allDrafts>();
	for (const draft of allDrafts) {
		if (!draft.reviewChainId) continue;
		const existing = chainMap.get(draft.reviewChainId) ?? [];
		existing.push(draft);
		chainMap.set(draft.reviewChainId, existing);
	}

	const chains: WatchedChain[] = [];
	for (const [chainId, drafts] of chainMap) {
		const sorted = drafts.sort((a, b) => b.roundNumber - a.roundNumber);
		const latest = sorted[0]!;

		if (latest.status !== "submitted" || !latest.commitSha) continue;

		chains.push({
			reviewChainId: chainId,
			prProvider: latest.prProvider,
			prIdentifier: latest.prIdentifier,
			lastKnownSha: latest.commitSha,
		});
	}

	return chains;
}

async function pollAllChains(): Promise<void> {
	const chains = getActiveChains();
	if (chains.length === 0) {
		stopPolling();
		return;
	}

	for (const chain of chains) {
		try {
			await pollChain(chain);
		} catch (err) {
			console.error(`[commit-poller] Error polling ${chain.prIdentifier}:`, err);
		}
	}
}

async function pollChain(chain: WatchedChain): Promise<void> {
	const { owner, repo, number: prNumber } = parsePrIdentifier(chain.prIdentifier);

	const git = getGitProvider(chain.prProvider);
	const { headSha, state: prState } = await git.getPRState(owner, repo, prNumber);

	if (prState === "merged" || prState === "closed") {
		console.log(`[commit-poller] PR ${chain.prIdentifier} is ${prState}, cleaning up`);
		const wsId = findReviewWorkspaceByPR(chain.prProvider, chain.prIdentifier);
		if (wsId) {
			await cleanupReviewWorkspace(wsId);
		}
		return;
	}

	if (headSha === chain.lastKnownSha) return;

	console.log(
		`[commit-poller] New commits on ${chain.prIdentifier}: ${chain.lastKnownSha.slice(0, 8)} -> ${headSha.slice(0, 8)}`
	);

	const settings = getSettings();

	if (settings.autoReviewEnabled) {
		try {
			const db = getDb();
			// Find workspace and worktree for this PR
			const workspace = db
				.select()
				.from(schema.workspaces)
				.where(
					and(
						eq(schema.workspaces.prProvider, chain.prProvider),
						eq(schema.workspaces.prIdentifier, chain.prIdentifier),
						eq(schema.workspaces.type, "review")
					)
				)
				.get();
			if (!workspace?.worktreeId) {
				console.error(`[commit-poller] No workspace for ${chain.prIdentifier}`);
				return;
			}
			const worktree = db
				.select()
				.from(schema.worktrees)
				.where(eq(schema.worktrees.id, workspace.worktreeId))
				.get();
			if (!worktree?.path) {
				console.error(`[commit-poller] No worktree for ${chain.prIdentifier}`);
				return;
			}

			// Fetch latest changes in worktree
			const { execFileSync } = await import("node:child_process");
			const latestDraft = db
				.select()
				.from(schema.reviewDrafts)
				.where(eq(schema.reviewDrafts.reviewChainId, chain.reviewChainId))
				.all()
				.sort((a, b) => b.roundNumber - a.roundNumber)[0];
			if (latestDraft) {
				try {
					execFileSync("git", ["fetch", "origin"], { cwd: worktree.path, stdio: "pipe" });
					execFileSync("git", ["reset", "--hard", `origin/${latestDraft.sourceBranch}`], {
						cwd: worktree.path,
						stdio: "pipe",
					});
				} catch (err) {
					console.error("[commit-poller] Failed to update worktree:", err);
				}
			}

			await queueFollowUpReview({
				reviewChainId: chain.reviewChainId,
				workspaceId: workspace.id,
				worktreePath: worktree.path,
			});
		} catch (err) {
			console.error(`[commit-poller] Auto follow-up failed for ${chain.prIdentifier}:`, err);
		}
	} else if (onNewCommitsHandler) {
		onNewCommitsHandler({
			reviewChainId: chain.reviewChainId,
			prIdentifier: chain.prIdentifier,
			oldSha: chain.lastKnownSha,
			newSha: headSha,
		});
	}
}

export function onNewCommits(handler: NewCommitsHandler): void {
	onNewCommitsHandler = handler;
}

export function startPolling(): void {
	if (pollTimer) return;

	const chains = getActiveChains();
	if (chains.length === 0) return;

	console.log(`[commit-poller] Starting — watching ${chains.length} chain(s)`);
	pollTimer = setInterval(() => {
		pollAllChains().catch((err) => console.error("[commit-poller] Poll cycle error:", err));
	}, POLL_INTERVAL_MS);
}

export function stopPolling(): void {
	if (pollTimer) {
		clearInterval(pollTimer);
		pollTimer = null;
		console.log("[commit-poller] Stopped");
	}
}

export async function checkPRNow(prIdentifier: string): Promise<void> {
	const chains = getActiveChains().filter((c) => c.prIdentifier === prIdentifier);
	for (const chain of chains) {
		await pollChain(chain);
	}
}
