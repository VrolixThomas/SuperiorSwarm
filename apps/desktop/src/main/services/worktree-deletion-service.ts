import { inArray } from "drizzle-orm";
import { getDb } from "../db";
import {
	agentMessages,
	agentSessions,
	orchestratorMembers,
	terminalSessions,
	workspaces,
	worktreeCleanupJobs,
	worktrees,
} from "../db/schema";
import { getDaemonClient } from "../terminal/daemon-instance";
import { getAgentSessionManager } from "./agent-session-manager-handle";
import { prepareWorktreeDeletion, startWorktreeDeletion } from "./worktree-deletion-coordinator";

export interface DeleteWorkspaceRecordsInput {
	workspaceIds: string[];
	worktreeId?: string | null;
	cleanup?: {
		repoPath: string;
		originalPath: string;
	};
}

/**
 * Atomically hides workspace/worktree state and records durable cleanup, then
 * disposes the captured runtime sessions before waking the cleanup worker.
 */
export async function deleteWorkspaceRecords(input: DeleteWorkspaceRecordsInput): Promise<void> {
	const db = getDb();
	const cleanupJob = input.cleanup ? await prepareWorktreeDeletion(input.cleanup) : null;
	const sessions =
		input.workspaceIds.length > 0
			? db
					.select({ id: terminalSessions.id })
					.from(terminalSessions)
					.where(inArray(terminalSessions.workspaceId, input.workspaceIds))
					.all()
			: [];
	const agentTerminalIds =
		input.workspaceIds.length > 0
			? db
					.select({ terminalId: agentSessions.terminalId })
					.from(agentSessions)
					.where(inArray(agentSessions.workspaceId, input.workspaceIds))
					.all()
					.map((session) => session.terminalId)
			: [];

	db.transaction((tx) => {
		if (cleanupJob) tx.insert(worktreeCleanupJobs).values(cleanupJob).run();
		if (input.workspaceIds.length > 0) {
			tx.delete(terminalSessions)
				.where(inArray(terminalSessions.workspaceId, input.workspaceIds))
				.run();
			tx.update(agentMessages)
				.set({ fromWorkspaceId: null })
				.where(inArray(agentMessages.fromWorkspaceId, input.workspaceIds))
				.run();
			tx.delete(orchestratorMembers)
				.where(inArray(orchestratorMembers.orchestratorId, input.workspaceIds))
				.run();
		}
		if (input.worktreeId) {
			tx.delete(worktrees)
				.where(inArray(worktrees.id, [input.worktreeId]))
				.run();
		}
		if (input.workspaceIds.length > 0) {
			tx.delete(workspaces).where(inArray(workspaces.id, input.workspaceIds)).run();
		}
	});

	getAgentSessionManager()?.removeSessions(agentTerminalIds);
	const daemon = getDaemonClient();
	for (const session of sessions) daemon?.dispose(session.id);
	if (cleanupJob) startWorktreeDeletion(cleanupJob);
}
