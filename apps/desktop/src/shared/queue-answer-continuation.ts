import type {
	ActivityQueueTarget,
	WorkspaceQueueAnswerInput,
	WorkspaceQueueReplyResult,
	WorkspaceQueueRevisionInput,
} from "./activity-queue";

export interface QueueAnswerBinding {
	questionId: string;
	answerId: string;
}
export interface QueueAnswerContinueInput extends WorkspaceQueueAnswerInput {
	requestId: string;
	/** Required when explicitly continuing an answer already shown as saved. */
	answerId?: string;
}
export interface QueueAnswerCapabilityInput extends WorkspaceQueueRevisionInput {
	questionId: string;
}
export interface QueueSavedAnswer {
	messageId: string;
	content: string;
	delivery: "saved" | "retrieved";
}
export interface QueueAnswerReceiptInput extends QueueAnswerCapabilityInput {
	requestId: string;
	answerId?: string;
}
export interface QueueAnswerContinueResult {
	answer: QueueSavedAnswer | null;
	continuation: WorkspaceQueueReplyResult | { status: "not-needed"; detail: string };
}

export type QueueAnswerTarget = Extract<ActivityQueueTarget, { type: "terminal" }>;

/** Lossless text envelope: escaped controls cannot become terminal input or provider commands. */
export function answerContinuationPrompt(binding: QueueAnswerBinding, content: string): string {
	// JSON.stringify already escapes C0 controls and unpaired surrogates. Escape remaining
	// terminal/bidi control codepoints as JSON escapes without changing the decoded answer.
	const controls = /[\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/gu;
	const encoded = JSON.stringify(content).replace(
		controls,
		(character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`
	);
	return `The saved answer to your question ${JSON.stringify(binding.questionId)} (answer ${JSON.stringify(binding.answerId)}) is this JSON string:\n${encoded}\nUse this answer to continue the task.`;
}

/** Content budget leaves room for identifiers and JSON framing inside the daemon frame. */
export function answerContinuationFits(prompt: string): boolean {
	return new TextEncoder().encode(JSON.stringify(prompt)).length <= 56_000;
}
