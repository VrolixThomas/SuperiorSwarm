import { useReviewModeStore } from "../stores/review-mode-store";

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
 * Single launch sequence for an AI review terminal: terminal registration,
 * drawer, PTY attach, and delayed launch-script write. Workspace metadata and
 * Review Mode activation are registered by activateReviewWorkspace first.
 * Returns false (doing nothing) when the launch info is incomplete.
 */
export function launchReviewTerminal(
	launchInfo: ReviewLaunchInfo,
	deps: ReviewLaunchDeps
): boolean {
	const { reviewWorkspaceId, worktreePath, launchScript } = launchInfo;
	if (!reviewWorkspaceId || !worktreePath || !launchScript) return false;

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
