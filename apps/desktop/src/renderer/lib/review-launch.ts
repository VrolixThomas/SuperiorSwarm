import type { PRContext } from "../../shared/github-types";
import { useReviewModeStore } from "../stores/review-mode-store";
import { useTabStore } from "../stores/tab-store";

export interface ReviewLaunchInfo {
	reviewWorkspaceId?: string | null;
	worktreePath?: string | null;
	launchScript?: string | null;
}

export interface ReviewLaunchDeps {
	attachTerminal: (input: { workspaceId: string; terminalId: string }) => void;
	writeTerminal: (tabId: string, data: string) => void;
	newTabId?: () => string;
	delayMs?: number;
}

/**
 * Single launch sequence for an AI review terminal: metadata, terminal
 * registration, drawer, PTY attach, and delayed launch-script write.
 * Returns false (doing nothing) when the launch info is incomplete.
 */
export function launchReviewTerminal(
	launchInfo: ReviewLaunchInfo,
	prCtx: PRContext,
	deps: ReviewLaunchDeps
): boolean {
	const { reviewWorkspaceId, worktreePath, launchScript } = launchInfo;
	if (!reviewWorkspaceId || !worktreePath || !launchScript) return false;

	useTabStore.getState().setWorkspaceMetadata(reviewWorkspaceId, {
		type: "review",
		prProvider: prCtx.provider,
		prIdentifier: `${prCtx.owner}/${prCtx.repo}#${prCtx.number}`,
		prTitle: prCtx.title,
		sourceBranch: prCtx.sourceBranch,
		targetBranch: prCtx.targetBranch,
	});
	const tabId = deps.newTabId?.() ?? `terminal-${crypto.randomUUID()}`;
	useReviewModeStore.getState().setTerminal({
		tabId,
		workspaceId: reviewWorkspaceId,
		cwd: worktreePath,
	});
	useReviewModeStore.getState().setDrawerOpen(true);
	deps.attachTerminal({ workspaceId: reviewWorkspaceId, terminalId: tabId });
	setTimeout(() => {
		deps.writeTerminal(tabId, `bash '${launchScript}'\n`);
	}, deps.delayMs ?? 500);
	return true;
}
