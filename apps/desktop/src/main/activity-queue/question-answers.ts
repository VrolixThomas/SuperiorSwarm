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
