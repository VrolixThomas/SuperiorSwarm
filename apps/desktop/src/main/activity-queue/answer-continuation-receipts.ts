import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import {
	type QueueAnswerBinding,
	type QueueAnswerTarget,
	answerContinuationPrompt,
} from "../../shared/queue-answer-continuation";
import { getDb } from "../db";
import { agentMessages, agentSessions, terminalSessions } from "../db/schema";
import { isAnswerContinuation, isQuestionAnswer } from "./question-answers";

/** Called only for an accepted exact-conversation prompt whose digest matches its delivery intent. */
export function markAnswerPromptReceived(
	binding: QueueAnswerBinding,
	target: QueueAnswerTarget,
	eventTime: number,
	promptHash: string
): boolean {
	const db = getDb();
	return db.transaction(() => {
		const question = db
			.select()
			.from(agentMessages)
			.where(eq(agentMessages.id, binding.questionId))
			.get();
		const answer = db
			.select()
			.from(agentMessages)
			.where(eq(agentMessages.id, binding.answerId))
			.get();
		if (
			!question ||
			!answer ||
			!isAnswerContinuation(question, answer, target) ||
			!Number.isFinite(eventTime) ||
			eventTime < answer.createdAt.getTime()
		)
			return false;
		const otherAnswers = db
			.select()
			.from(agentMessages)
			.where(eq(agentMessages.inReplyTo, question.id))
			.all();
		if (otherAnswers.some((other) => other.id !== answer.id && isQuestionAnswer(question, other)))
			return false;
		const session = db
			.select()
			.from(agentSessions)
			.where(eq(agentSessions.terminalId, target.terminalId))
			.get();
		const terminal = db
			.select()
			.from(terminalSessions)
			.where(eq(terminalSessions.id, target.terminalId))
			.get();
		if (
			!session ||
			terminal?.workspaceId !== target.workspaceId ||
			session.workspaceId !== target.workspaceId ||
			session.entityKind !== target.entity?.kind ||
			session.provider !== target.provider ||
			session.providerSessionId !== target.providerSessionId
		)
			return false;
		const expected = createHash("sha256")
			.update(answerContinuationPrompt(binding, answer.content))
			.digest("hex");
		if (promptHash !== expected) return false;
		if (!answer.retrievedAt)
			db.update(agentMessages)
				.set({ retrievedAt: new Date(eventTime) })
				.where(eq(agentMessages.id, answer.id))
				.run();
		return true;
	});
}
