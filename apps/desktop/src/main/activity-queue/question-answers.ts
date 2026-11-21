import type { AgentMessage } from "../db/schema";

/** Shared resolution/display/deduplication predicate. Wrong or older answers cannot poison a question. */
export function isQuestionAnswer(question: AgentMessage, answer: AgentMessage): boolean {
	if (
		question.kind !== "question" ||
		answer.kind !== "answer" ||
		answer.inReplyTo !== question.id ||
		answer.projectId !== question.projectId ||
		answer.createdAt < question.createdAt
	)
		return false;
	if (!question.reporter)
		return (
			!answer.recipient &&
			(answer.toWorkspaceId === question.fromWorkspaceId || answer.toWorkspaceId === null)
		);
	const owner = question.reporter;
	const recipient = answer.recipient;
	return (
		owner.type === "terminal" &&
		recipient?.type === "terminal" &&
		answer.toWorkspaceId === question.fromWorkspaceId &&
		recipient.workspaceId === owner.workspaceId &&
		recipient.terminalId === owner.terminalId &&
		recipient.provider === owner.provider &&
		recipient.providerSessionId === owner.providerSessionId &&
		(recipient.entity?.kind ?? "workspace") === (owner.entity?.kind ?? "workspace") &&
		(recipient.entity?.id ?? recipient.workspaceId) === (owner.entity?.id ?? owner.workspaceId)
	);
}

/** A continuation may expose only the exact answer already bound to the reporting chat. */
export function isAnswerContinuation(
	question: AgentMessage,
	answer: AgentMessage,
	target: import("../../shared/queue-answer-continuation").QueueAnswerTarget
): boolean {
	if (
		!isQuestionAnswer(question, answer) ||
		!question.reporter ||
		!answer.recipient ||
		!target.providerSessionId ||
		!target.entity ||
		target.entity.id !== target.workspaceId ||
		question.fromWorkspaceId !== target.workspaceId
	)
		return false;
	const recipient = answer.recipient;
	return (
		recipient.type === "terminal" &&
		target.entity !== undefined &&
		recipient.workspaceId === target.workspaceId &&
		recipient.terminalId === target.terminalId &&
		recipient.provider === target.provider &&
		recipient.providerSessionId === target.providerSessionId &&
		(recipient.entity?.kind ?? "workspace") === target.entity.kind &&
		(recipient.entity?.id ?? recipient.workspaceId) === target.entity.id
	);
}
