import { eq } from "drizzle-orm";
import type { ReviewPathRunScope, ReviewPathRunState } from "../../shared/review-path-runtime";
import type {
	ReviewPathTerminalState,
	ReviewPathTerminalStateInput,
} from "../../shared/review-path-status";
import {
	canonicalWorkspaceDirectory,
	getWorkspaceCwdOrThrow,
} from "../agent-launch/workspace-cwd-lookup";
import type { getDb } from "../db";
import { terminalSessions } from "../db/schema";
import { getDaemonClient } from "../terminal/daemon-instance";
import { reviewTerminalOwnership } from "../terminal/review-terminal-ownership";
import { ReviewPathStorage } from "./storage";

const unavailable = (): ReviewPathTerminalState => ({
	status: "unavailable",
	message: "This agent terminal is unavailable for this review workspace.",
});
function ended(runState: ReviewPathRunState): ReviewPathTerminalState {
	const descriptions: Record<ReviewPathRunState, string> = {
		running: "The agent terminal is no longer running.",
		completed: "This agent run completed. Its terminal session has ended.",
		cancelled: "This agent run was cancelled. Its terminal session has ended.",
		failed: "This agent run failed. Its terminal session has ended.",
		superseded: "This agent run was replaced by a newer run. Its terminal session has ended.",
	};
	return { status: "ended", runState, message: descriptions[runState] };
}

/** Inspection never attaches, launches, deletes, or writes to a terminal or durable state. */
export async function readReviewPathTerminalState(
	db: ReturnType<typeof getDb>,
	input: ReviewPathTerminalStateInput
): Promise<ReviewPathTerminalState> {
	try {
		// The existing IPC ownership fence does not require a surviving session row.
		const ownership = reviewTerminalOwnership(db, input.terminalId, input.workspaceId);
		const scope = JSON.parse(ownership) as ReviewPathRunScope;
		const currentRunState = () => {
			const run = new ReviewPathStorage(db)
				.peek(scope.identity)
				.runs.find(
					(candidate) =>
						candidate.id === scope.id &&
						candidate.version === scope.version &&
						candidate.terminalId === input.terminalId
				);
			if (
				!run ||
				!["running", "completed", "cancelled", "failed", "superseded"].includes(run.state)
			)
				throw new Error("Unknown run");
			return run.state;
		};
		const session = () =>
			db.select().from(terminalSessions).where(eq(terminalSessions.id, input.terminalId)).get();
		const row = session();
		if (!row) return ended(currentRunState());
		if (row.workspaceId !== input.workspaceId) return unavailable();
		const cwd = getWorkspaceCwdOrThrow(input.workspaceId);
		if (canonicalWorkspaceDirectory(row.cwd) !== cwd) return unavailable();
		const daemon = getDaemonClient();
		if (!daemon?.isConnected)
			return {
				status: "unavailable",
				runState: currentRunState(),
				message: "The terminal service is unavailable. Try again shortly.",
			};
		let inventory: Awaited<ReturnType<typeof daemon.listSessionsStrict>> | undefined;
		try {
			inventory = await daemon.listSessionsStrict();
		} catch {
			/* Inventory failure is not proof of exit. */
		}
		// Inventory yields; an old selector must not disclose or attach a replacement's state.
		if (reviewTerminalOwnership(db, input.terminalId, input.workspaceId) !== ownership)
			return unavailable();
		const runState = currentRunState();
		const current = session();
		if (!current) return ended(runState);
		if (
			current.workspaceId !== input.workspaceId ||
			getWorkspaceCwdOrThrow(input.workspaceId) !== cwd ||
			canonicalWorkspaceDirectory(current.cwd) !== cwd
		)
			return unavailable();
		if (!inventory || !daemon.isConnected || getDaemonClient() !== daemon)
			return {
				status: "unavailable",
				runState,
				message: "The terminal service is unavailable. Try again shortly.",
			};
		const live = inventory.find((candidate) => candidate.id === input.terminalId);
		if (!live) return ended(runState);
		if (canonicalWorkspaceDirectory(live.cwd) !== cwd) return unavailable();
		return {
			status: "available",
			runState,
			cwd,
			message:
				runState === "running"
					? "Agent terminal is available."
					: "Agent output is available in its existing terminal.",
		};
	} catch {
		return unavailable();
	}
}
