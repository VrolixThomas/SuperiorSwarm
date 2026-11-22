import { readFileSync } from "node:fs";
import { and, eq, inArray } from "drizzle-orm";
import type { WorkspaceQueueRevisionInput } from "../../shared/activity-queue";
import { pollWorkspace } from "../ai-review/comment-poller";
import { createAndQueueSolve } from "../ai-review/create-and-queue-solve";
import { getSettings } from "../ai-review/orchestrator";
import { requestConfirm } from "../control-plane/confirm-bridge";
import { getDb } from "../db";
import { commentSolveSessions, workspaces } from "../db/schema";
import { defaultSpawnFn } from "../services/workspace-service";
import { currentExternalQueueItem } from "./queue-view";
const running = new Set<string>();
export async function solveQueuePRFeedback(input: WorkspaceQueueRevisionInput) {
	const requireLinked = () => {
		const item = currentExternalQueueItem(input);
		if (
			!item ||
			item.kind !== "pr-feedback" ||
			item.target.type !== "pr" ||
			!item.context.workspaceId
		)
			throw new Error("Link one workspace to this PR before solving feedback.");
		const row = getDb()
			.select()
			.from(workspaces)
			.where(eq(workspaces.id, item.context.workspaceId))
			.get();
		if (
			!row ||
			row.prProvider !== item.target.provider ||
			row.prIdentifier !== `${item.target.owner}/${item.target.repo}#${item.target.number}` ||
			!row.worktreeId
		)
			throw new Error("The linked worktree is unavailable or changed.");
		if (
			getDb()
				.select()
				.from(commentSolveSessions)
				.where(
					and(
						eq(commentSolveSessions.workspaceId, row.id),
						inArray(commentSolveSessions.status, ["queued", "in_progress"])
					)
				)
				.get()
		)
			throw new Error("A solver is already running for this workspace.");
		return row;
	};
	const workspace = requireLinked();
	if (running.has(workspace.id)) throw new Error("A solver launch is already in progress.");
	running.add(workspace.id);
	try {
		const settings = getSettings();
		if (
			!(await requestConfirm({
				kind: "dispatch",
				workspaceName: workspace.name,
				branch: null,
				summary: `Solve feedback on ${workspace.prIdentifier} using the configured ${settings.cliPreset} solver. This runs locally and does not submit replies or approve the PR.`,
			}))
		)
			return { status: "cancelled" as const };
		requireLinked();
		if (
			getSettings().cliPreset !== settings.cliPreset ||
			getSettings().skipPermissions !== settings.skipPermissions
		)
			throw new Error("Solver configuration changed while confirming. Review the launch again.");
		await pollWorkspace(workspace);
		requireLinked();
		if (
			getSettings().cliPreset !== settings.cliPreset ||
			getSettings().skipPermissions !== settings.skipPermissions
		)
			throw new Error("Solver configuration changed. Review the launch again.");
		const solve = await createAndQueueSolve({ workspaceId: workspace.id });
		try {
			const spawned = await defaultSpawnFn({
				workspaceId: workspace.id,
				cwd: solve.worktreePath,
				title: "PR feedback solver",
				openInRenderer: false,
				launchScriptContent: readFileSync(solve.launchScript, "utf8"),
			});
			if (!spawned.launch) throw new Error("Solver launch could not be prepared.");
			return {
				status: "prepared" as const,
				sessionId: solve.sessionId,
				launch: { workspaceId: workspace.id, terminalId: spawned.terminalId, ...spawned.launch },
			};
		} catch (error) {
			getDb()
				.update(commentSolveSessions)
				.set({ status: "failed", updatedAt: new Date() })
				.where(eq(commentSolveSessions.id, solve.sessionId))
				.run();
			throw error;
		}
	} finally {
		running.delete(workspace.id);
	}
}
