import type {
	ActivityQueueItem,
	ActivityQueueSource,
	WorkspaceQueueItem,
} from "../../shared/activity-queue";

export function projectTint(projectId: string): number {
	let hash = 0;
	for (const character of projectId) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) | 0;
	return ((hash >>> 0) % 8) + 1;
}

/** Classification uses structured source evidence, never guesses from display text. */
export function describeWorkspaceItem(
	item: ActivityQueueItem,
	source: ActivityQueueSource,
	context: WorkspaceQueueItem["context"]
): WorkspaceQueueItem {
	const snapshot = source.snapshot;
	const rawEvent =
		snapshot && typeof snapshot === "object" && "rawEvent" in snapshot ? snapshot.rawEvent : null;
	const hasReason = (code: string) => item.reasons.some((reason) => reason.code === code);
	const situation: WorkspaceQueueItem["situation"] =
		source.sourceType === "agent-question"
			? "agent-question"
			: hasReason("turn-failed") || rawEvent === "StopFailure"
				? "agent-failed"
				: rawEvent === "PermissionRequest"
					? "agent-permission"
					: item.kind === "agent-ready"
						? "agent-done"
						: "agent-input";
	const descriptions = {
		"agent-question": [
			"The agent asked a question.",
			"Clears when this question is answered, or you mark it Done.",
		],
		"agent-failed": [
			"The agent reported a failed turn.",
			"Clears when the agent continues, or you mark it Done.",
		],
		"agent-permission": [
			"The agent requested permission in its terminal.",
			"Clears when the agent continues, or you mark it Done.",
		],
		"agent-done": [
			"The agent reported completion.",
			"Clears when you continue the task, or mark it Done.",
		],
		"agent-input": [
			"The agent needs input.",
			"Clears when the agent continues, or you mark it Done.",
		],
	} as const;
	const [why, clearsWhen] = descriptions[situation];
	return {
		...item,
		title: context.workspaceName,
		projectId: context.projectId,
		projectName: context.projectName,
		category: "agents",
		situation,
		subject: context.workspaceName,
		why,
		clearsWhen,
		context,
		evidence: [...new Set([item.summary, ...item.reasons.map((reason) => reason.label)])]
			.filter((value) => value.trim().length > 0)
			.slice(0, 4),
	};
}
