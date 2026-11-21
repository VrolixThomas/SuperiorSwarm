import type {
	ActivityQueueItem,
	ActivityQueueSource,
	WorkspaceQueueItem,
} from "../../shared/activity-queue";
import { validateAgentEvidence } from "../../shared/agent-evidence";
import type { AgentEventSnapshot } from "./agent-event-order";

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
	const eventSnapshot = snapshot as Partial<AgentEventSnapshot> | null;
	const rawEvent =
		snapshot && typeof snapshot === "object" && "rawEvent" in snapshot ? snapshot.rawEvent : null;
	const hasReason = (code: string) => item.reasons.some((reason) => reason.code === code);
	const situation: WorkspaceQueueItem["situation"] =
		source.sourceType === "agent-question"
			? "agent-question"
			: hasReason("turn-failed") || rawEvent === "StopFailure"
				? "agent-failed"
				: hasReason("permission-unresolved") || rawEvent === "PermissionRequest"
					? "agent-permission"
					: item.kind === "agent-ready"
						? "agent-done"
						: "agent-input";
	const chat = source.sourceType === "agent-session";
	const entityText = (text: string) =>
		context.role === "coordinator"
			? text.replace(/workspace/g, "coordinator").replace(/Workspace/g, "Coordinator")
			: text;
	const provider =
		context.provider === "codex"
			? "Codex"
			: context.provider === "claude"
				? "Claude"
				: context.provider;
	const sourceLabel = chat
		? `${provider ?? "Agent"} chat`
		: situation === "agent-question"
			? "Agent question"
			: entityText("Workspace update");
	const descriptions = {
		"agent-question": {
			why: "Answer the question",
			nextAction:
				"Send an answer to this question. Ordinary chat input does not submit an answer here.",
			openLabel: "Open question’s conversation",
			detailLabel: "Question from the agent",
			missingContext: "The question text is unavailable here. Open the workspace to read it.",
		},
		"agent-failed": {
			why: "Review the failed turn",
			nextAction:
				"Read the error in the chat, then decide whether to retry or give different instructions.",
			openLabel: "Open chat to inspect error",
			detailLabel: "Error details",
			missingContext:
				"The agent reported a failed turn without an error message. Open the chat for details.",
		},
		"agent-permission": {
			why: "Decide on a permission request",
			nextAction: "Review the requested action in the chat and choose whether to allow it.",
			openLabel: "Open chat to review permission",
			detailLabel: "Permission request",
			missingContext:
				"The requested command or permission was not included in the notification. Review it in the chat before deciding.",
		},
		"agent-done": chat
			? {
					why: "Review the latest reply",
					nextAction:
						"Read the latest reply. Continue the chat if more work is needed, or mark this item Done after reviewing it.",
					openLabel: "Open chat to read reply",
					detailLabel: "Latest reply",
					missingContext:
						"This notification only says the turn ended. It does not include the reply or confirm that the task is finished.",
				}
			: {
					why: "Review completed work",
					nextAction:
						"Review the agent’s report below and check the result in the workspace. Request changes if needed, or mark this item Done.",
					openLabel: "Open workspace to review",
					detailLabel: "Agent’s report",
					missingContext:
						"The agent marked the task complete without a report. Open the workspace to see what changed.",
				},
		"agent-input": {
			why: "Reply to the agent",
			nextAction: chat
				? "Open the chat and respond to the agent’s request. If it is already handled, mark this item Done."
				: "Open the workspace and respond to the agent’s request. If it is already handled, mark this item Done.",
			openLabel: chat ? "Open chat to respond" : "Open workspace to respond",
			detailLabel: "What the agent needs",
			missingContext:
				"The notification says input is needed, but does not include the request. Open the chat to see what the agent is asking.",
		},
	};
	const description = descriptions[situation];
	// Generic lifecycle labels are not a question, reply or completion report.
	const generic = new Set([
		"Ready for next input",
		"Task complete",
		"Needs input",
		"Agent needs input",
		"Agent turn failed; needs attention",
		"Unanswered question",
	]);
	const summary = item.summary.trim();
	// Each retained field keeps the provider event that admitted it (e.g. permission + later Stop).
	let remaining = 4096;
	const providerEvidence = (Array.isArray(eventSnapshot?.evidence) ? eventSnapshot.evidence : [])
		.slice(0, 4)
		.flatMap((entry) => {
			if (
				!entry ||
				typeof entry !== "object" ||
				typeof entry.rawEvent !== "string" ||
				remaining <= 0
			)
				return [];
			return validateAgentEvidence([entry], context.provider ?? "", entry.rawEvent).map((value) => {
				const text = value.text.slice(0, remaining);
				remaining -= text.length;
				return { ...value, text, truncated: value.truncated || text.length < value.text.length };
			});
		});
	const evidence = [
		...new Set([
			...(summary && !generic.has(summary) ? [summary] : []),
			...providerEvidence.map((value) => value.text),
		]),
	];
	const terminalTitle = context.terminalTitle?.trim();
	const questionText = summary.replace(/\s+/g, " ");
	const questionTitle = questionText.match(/^.*?[.!?](?:\s|$)/)?.[0].trim() || questionText;
	const subject =
		situation === "agent-question" && evidence.length
			? questionTitle.length > 96
				? `${questionTitle.slice(0, 93)}…`
				: questionTitle
			: chat && terminalTitle && !/^(Terminal(?: \d+)?|Agent session)$/i.test(terminalTitle)
				? terminalTitle
				: context.workspaceName;
	return {
		...item,
		title: subject,
		projectId: context.projectId,
		projectName: context.projectName,
		category: "agents",
		situation,
		subject,
		why: description.why,
		nextAction: entityText(description.nextAction),
		openLabel:
			item.target.type === "terminal"
				? description.openLabel.replace("workspace", "chat")
				: entityText(description.openLabel),
		detailLabel: description.detailLabel,
		missingContext: evidence.length ? undefined : entityText(description.missingContext),
		sourceLabel,
		clearsWhen:
			"Done removes this item from the queue. It does not send a reply or finish the task.",
		context,
		providerEvidence,
		permission: eventSnapshot?.permission ?? undefined,
		ordering: eventSnapshot?.ordering,
		evidence,
	};
}
