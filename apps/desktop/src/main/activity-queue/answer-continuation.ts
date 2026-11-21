import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type {
	WorkspaceQueueReplyCapability,
	WorkspaceQueueReplyInput,
	WorkspaceQueueReplyResult,
	WorkspaceQueueRevisionInput,
} from "../../shared/activity-queue";
import {
	type QueueAnswerBinding,
	type QueueAnswerCapabilityInput,
	type QueueAnswerContinueInput,
	type QueueAnswerContinueResult,
	type QueueAnswerTarget,
	type QueueSavedAnswer,
	answerContinuationFits,
	answerContinuationPrompt,
} from "../../shared/queue-answer-continuation";
import { getDb } from "../db";
import { agentMessages } from "../db/schema";
import { activityQueueDeliveries } from "../db/schema-activity-queue";
import { questionSourceId } from "./agent-source";
import { isAnswerContinuation, isQuestionAnswer } from "./question-answers";
import { currentQueueAction, workspaceAnswer } from "./workspace-queue";

/** The shared continuation transport owns process admission, locking and durable send idempotency. */
export interface AnswerContinuationTransport {
	capability: (
		input: WorkspaceQueueRevisionInput,
		questionId?: string
	) => Promise<WorkspaceQueueReplyCapability>;
	submit: (
		input: WorkspaceQueueReplyInput,
		binding?: QueueAnswerBinding
	) => Promise<WorkspaceQueueReplyResult>;
	receipt: (requestId: string) => WorkspaceQueueReplyResult | null;
}
const unavailable = (reason: string): WorkspaceQueueReplyResult => ({
	status: "unavailable",
	reason,
});
function saved(row: typeof agentMessages.$inferSelect): QueueSavedAnswer {
	return {
		messageId: row.id,
		content: row.content,
		delivery: row.retrievedAt ? "retrieved" : "saved",
	};
}
function readAnswer(questionId: string, answerId?: string) {
	const db = getDb();
	const question = db.select().from(agentMessages).where(eq(agentMessages.id, questionId)).get();
	if (!question || question.kind !== "question") return null;
	const answers = db
		.select()
		.from(agentMessages)
		.where(eq(agentMessages.inReplyTo, questionId))
		.all()
		.filter((answer) => isQuestionAnswer(question, answer));
	if (answers.length !== 1) return { question, answer: null, ambiguous: answers.length > 1 };
	const answer = answers[0];
	return {
		question,
		answer: answer && (!answerId || answer.id === answerId) ? answer : null,
		ambiguous: false,
	};
}
function receiptMatches(
	input: WorkspaceQueueRevisionInput,
	row: typeof activityQueueDeliveries.$inferSelect,
	target: QueueAnswerTarget,
	prompt: string
): boolean {
	const owner = row.target;
	return (
		owner.type === "terminal" &&
		owner.entity?.kind === target.entity?.kind &&
		owner.entity?.id === target.entity?.id &&
		owner.workspaceId === target.workspaceId &&
		owner.terminalId === target.terminalId &&
		owner.provider === target.provider &&
		owner.providerSessionId === target.providerSessionId &&
		row.fingerprint === createHash("sha256").update(prompt).digest("hex") &&
		[{ id: input.id, revision: input.revision }, ...(input.members ?? [])].every((member) =>
			row.members.some((saved) => saved.id === member.id && saved.revision === member.revision)
		)
	);
}

export async function workspaceAnswerContinuationCapability(
	input: QueueAnswerCapabilityInput,
	transport: AnswerContinuationTransport
): Promise<WorkspaceQueueReplyCapability> {
	const item = await currentQueueAction(input);
	if (
		!item?.question ||
		item.question.messageId !== input.questionId ||
		input.id !== questionSourceId(input.questionId)
	)
		return {
			status: "unavailable",
			reason: "This question changed or was handled. Refresh the queue.",
		};
	return transport.capability(input, input.questionId);
}

/** Saving is durable independently of continuation. Retry reuses the exact persisted answer. */
export async function workspaceAnswerAndContinue(
	input: QueueAnswerContinueInput,
	transport: AnswerContinuationTransport
): Promise<QueueAnswerContinueResult> {
	const content = input.content.trim();
	if (
		!input.requestId ||
		input.requestId.length > 128 ||
		input.id !== questionSourceId(input.questionId) ||
		!content ||
		content.length > 16000
	)
		return {
			answer: null,
			continuation: unavailable("Enter an answer of 1 to 16000 characters for this question."),
		};
	let existing = getDb()
		.select()
		.from(activityQueueDeliveries)
		.where(eq(activityQueueDeliveries.requestId, input.requestId))
		.get();
	let record = readAnswer(input.questionId, input.answerId);
	if (existing && !record?.answer)
		return {
			answer: null,
			continuation: {
				status: "conflict",
				reason: "This request ID already belongs to another delivery.",
			},
		};
	if (!record || record.ambiguous)
		return {
			answer: null,
			continuation: unavailable(
				record?.ambiguous
					? "Multiple answers exist. Open this conversation to review them."
					: "This question is no longer available."
			),
		};
	if (input.answerId && !record.answer)
		return {
			answer: null,
			continuation: {
				status: "conflict",
				reason: "The saved answer changed. Refresh before continuing.",
			},
		};
	if (!record.answer) {
		const result = await workspaceAnswer({ ...input, content });
		record = readAnswer(input.questionId, input.answerId);
		if (!record?.answer)
			return {
				answer: null,
				continuation: unavailable(
					result.status === "saved"
						? "The saved answer is no longer available."
						: (result.reason ?? "The question changed before the answer could be saved.")
				),
			};
	}
	const { question, answer } = record;
	if (!answer) return { answer: null, continuation: unavailable("The answer is unavailable.") };
	const answerReceipt = saved(answer);
	if (answer.content !== content)
		return {
			answer: answerReceipt,
			continuation: {
				status: "conflict",
				reason: "A different answer is already saved. Refresh and review it before continuing.",
			},
		};
	const target = question.reporter;
	if (target?.type !== "terminal" || !isAnswerContinuation(question, answer, target))
		return {
			answer: answerReceipt,
			continuation: unavailable(
				"The saved answer has no verified exact recipient. Open the conversation."
			),
		};
	const binding = { questionId: question.id, answerId: answer.id };
	const prompt = answerContinuationPrompt(binding, answer.content);
	existing =
		existing ??
		getDb()
			.select()
			.from(activityQueueDeliveries)
			.where(eq(activityQueueDeliveries.requestId, input.requestId))
			.get();
	if (existing)
		return {
			answer: answerReceipt,
			continuation: receiptMatches(input, existing, target, prompt)
				? (transport.receipt(input.requestId) ?? {
						status: "uncertain",
						requestId: input.requestId,
						detail: "Delivery status is unavailable. Open the conversation; do not resend.",
					})
				: {
						status: "conflict",
						reason: "This request ID belongs to a different answer or queue occurrence.",
					},
		};
	if (answer.retrievedAt)
		return {
			answer: answerReceipt,
			continuation: unavailable(
				"The agent has already received this answer. Refresh the queue for its current task."
			),
		};
	if (!answerContinuationFits(prompt))
		return {
			answer: answerReceipt,
			continuation: unavailable(
				"The answer was saved, but is too large to continue safely from here. Open the chat and ask it to check its messages."
			),
		};
	try {
		return {
			answer: answerReceipt,
			continuation: await transport.submit({ ...input, content: prompt }, binding),
		};
	} catch {
		return {
			answer: answerReceipt,
			continuation: {
				status: "uncertain",
				requestId: input.requestId,
				detail:
					"The answer was saved. Continuation delivery is uncertain; check its status or open the conversation before trying again.",
			},
		};
	}
}

/** Status recovery never saves an answer, creates an intent, resumes or writes into a chat. */
export function workspaceAnswerContinuationReceipt(
	input: QueueAnswerCapabilityInput & { answerId: string; requestId: string },
	transport: AnswerContinuationTransport
): QueueAnswerContinueResult {
	const record = readAnswer(input.questionId, input.answerId);
	if (!record?.answer || record.ambiguous || input.id !== questionSourceId(input.questionId))
		return {
			answer: null,
			continuation: { status: "conflict", reason: "This saved answer is no longer available." },
		};
	const { question, answer } = record;
	const target = question.reporter;
	const row = getDb()
		.select()
		.from(activityQueueDeliveries)
		.where(eq(activityQueueDeliveries.requestId, input.requestId))
		.get();
	const prompt = answerContinuationPrompt(
		{ questionId: question.id, answerId: answer.id },
		answer.content
	);
	if (
		row &&
		(target?.type !== "terminal" ||
			!isAnswerContinuation(question, answer, target) ||
			!receiptMatches(input, row, target, prompt))
	)
		return {
			answer: saved(answer),
			continuation: {
				status: "conflict",
				reason: "This request belongs to another answer or queue update.",
			},
		};
	return {
		answer: saved(answer),
		continuation: row
			? (transport.receipt(input.requestId) ?? {
					status: "uncertain",
					requestId: input.requestId,
					detail: "Delivery status is unavailable. Open the conversation; do not resend.",
				})
			: {
					status: "uncertain",
					requestId: input.requestId,
					detail:
						"No delivery receipt is available yet. This check did not resend anything. Open the conversation before retrying.",
				},
	};
}
