import type { ReviewPathLaunchResult } from "../../shared/review-path-runtime";
import { useReviewModeStore } from "../stores/review-mode-store";

/** Main has already launched the owned PTY. Register it without writing another prompt. */
export async function attachReadingPathTerminal(
	workspaceId: string,
	launch: ReviewPathLaunchResult,
	attach: (input: { workspaceId: string; terminalId: string }) => Promise<unknown>
): Promise<boolean> {
	if (
		launch.reviewWorkspaceId !== workspaceId ||
		!launch.worktreePath ||
		!launch.terminalId?.startsWith("review-path:")
	)
		return false;
	await attach({ workspaceId, terminalId: launch.terminalId });
	useReviewModeStore
		.getState()
		.setTerminal({ workspaceId, tabId: launch.terminalId, cwd: launch.worktreePath });
	return true;
}
