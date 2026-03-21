import { eq } from "drizzle-orm";
import { getPRState as getBitbucketPRState } from "../atlassian/bitbucket";
import { getDb } from "../db";
import * as schema from "../db/schema";
import { removeWorktree } from "../git/operations";
import { getPRState as getGitHubPRState } from "../github/github";
import { getSettings, queueFollowUpReview } from "./orchestrator";

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

function parsePrIdentifier(identifier: string): {
	ownerOrWorkspace: string;
	repo: string;
	number: number;
} {
	const [ownerRepo, numStr] = identifier.split("#");
	const [ownerOrWorkspace, repo] = ownerRepo!.split("/");
	return {
		ownerOrWorkspace: ownerOrWorkspace!,
		repo: repo!,
		number: Number.parseInt(numStr!, 10),
	};
}

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
	const { ownerOrWorkspace, repo, number: prNumber } = parsePrIdentifier(chain.prIdentifier);

	let headSha: string;
	let prState: string;

	if (chain.prProvider === "github") {
		const result = await getGitHubPRState(ownerOrWorkspace, repo, prNumber);
		headSha = result.headSha;
		prState = result.merged ? "merged" : result.state;
	} else {
		const result = await getBitbucketPRState(ownerOrWorkspace, repo, prNumber);
		headSha = result.headSha;
		prState = result.state.toLowerCase();
	}

	if (prState === "merged" || prState === "closed") {
		console.log(`[commit-poller] PR ${chain.prIdentifier} is ${prState}, cleaning up`);
		await cleanupChainWorktree(chain.prIdentifier);
		return;
	}

	if (headSha === chain.lastKnownSha) return;

	console.log(
		`[commit-poller] New commits on ${chain.prIdentifier}: ${chain.lastKnownSha.slice(0, 8)} -> ${headSha.slice(0, 8)}`
	);

	const settings = getSettings();

	if (settings.autoReviewEnabled) {
		try {
			await queueFollowUpReview(chain.reviewChainId);
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

async function cleanupChainWorktree(prIdentifier: string): Promise<void> {
	const db = getDb();

	const workspace = db
		.select()
		.from(schema.reviewWorkspaces)
		.where(eq(schema.reviewWorkspaces.prIdentifier, prIdentifier))
		.get();

	if (!workspace?.worktreeId) return;

	const worktree = db
		.select()
		.from(schema.worktrees)
		.where(eq(schema.worktrees.id, workspace.worktreeId))
		.get();

	if (worktree?.path) {
		const project = db
			.select()
			.from(schema.projects)
			.where(eq(schema.projects.id, workspace.projectId))
			.get();

		if (project) {
			try {
				await removeWorktree(project.repoPath, worktree.path);
			} catch (err) {
				console.error("[commit-poller] Failed to remove worktree:", err);
			}
		}

		db.delete(schema.worktrees).where(eq(schema.worktrees.id, workspace.worktreeId)).run();
	}

	db.update(schema.reviewWorkspaces)
		.set({ worktreeId: null, updatedAt: new Date() })
		.where(eq(schema.reviewWorkspaces.id, workspace.id))
		.run();
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
