import { useCallback, useEffect, useRef, useState } from "react";
import type {
	WorkspaceQueueAnswerInput,
	WorkspaceQueueAnswerResult,
	WorkspaceQueueItem,
	WorkspaceQueueReplyCapability,
	WorkspaceQueueRevisionInput,
} from "../../../shared/activity-queue";
import type {
	QueueAnswerCapabilityInput,
	QueueAnswerContinueInput,
	QueueAnswerContinueResult,
	QueueAnswerReceiptInput,
	QueueSavedAnswer,
} from "../../../shared/queue-answer-continuation";
import { queueFocus } from "./QueueRow";

export interface QueueAnswerContinuationActions {
	capability: (input: QueueAnswerCapabilityInput) => Promise<WorkspaceQueueReplyCapability>;
	continue: (input: QueueAnswerContinueInput) => Promise<QueueAnswerContinueResult>;
	receipt: (input: QueueAnswerReceiptInput) => Promise<QueueAnswerContinueResult>;
}
const itemReceipt = (item: WorkspaceQueueItem): WorkspaceQueueRevisionInput => ({
	id: item.id,
	revision: item.revision,
	members: item.members?.map(({ id, revision }) => ({ id, revision })),
});
type Continuation = { input: QueueAnswerContinueInput; result?: QueueAnswerContinueResult };
type Draft = {
	content: string;
	revision: number;
	questionId: string;
	receipt: WorkspaceQueueRevisionInput;
	target: string;
	savedAnswer?: QueueSavedAnswer;
	error?: string;
	saved?: string;
};
export type AnswerQuestion = (
	input: WorkspaceQueueAnswerInput
) => Promise<WorkspaceQueueAnswerResult>;

/** Drafts keep their displayed revision even when polling delivers newer activity. */
export function QueueQuestionReply({
	item,
	available,
	answer,
	continuationActions,
	refresh,
	inputId = "queue-question-answer",
}: {
	item: WorkspaceQueueItem;
	available: boolean;
	answer?: AnswerQuestion;
	continuationActions?: QueueAnswerContinuationActions;
	refresh: () => Promise<unknown>;
	inputId?: string;
}) {
	const [drafts, setDrafts] = useState<Record<string, Draft>>({});
	const [busy, setBusy] = useState(false);
	const [continuations, setContinuations] = useState<Record<string, Continuation>>({});
	const [capabilityResult, setCapabilityResult] = useState<{
		key: string;
		value: WorkspaceQueueReplyCapability;
	}>();
	const running = useRef(false);
	const requests = useRef<
		Record<string, { requestId: string; result?: QueueAnswerContinueResult }>
	>({});
	const question = item.question;
	const draft = drafts[item.id] ?? {
		content: "",
		revision: item.revision,
		questionId: question?.messageId ?? "",
		receipt: itemReceipt(item),
		target: JSON.stringify(item.target),
	};
	const update = (patch: Partial<Draft>) =>
		setDrafts((all) => ({ ...all, [item.id]: { ...draft, ...patch } }));
	const changed =
		draft.revision !== item.revision ||
		draft.questionId !== question?.messageId ||
		JSON.stringify(draft.receipt) !== JSON.stringify(itemReceipt(item)) ||
		draft.target !== JSON.stringify(item.target);
	const continuation = continuations[item.id];
	const locked =
		!!continuation &&
		(!continuation.result ||
			["admitted", "uncertain", "received"].includes(continuation.result.continuation.status));
	const projectedAnswer = question?.answer
		? {
				messageId: question.answer.messageId,
				content: question.answer.content ?? draft.content,
				delivery: question.answer.delivery,
			}
		: undefined;
	const persistedAnswer =
		draft.savedAnswer?.delivery === "retrieved" &&
		draft.savedAnswer.messageId === projectedAnswer?.messageId &&
		draft.savedAnswer.content === projectedAnswer.content
			? draft.savedAnswer
			: (projectedAnswer ?? draft.savedAnswer);
	const capabilityKey = JSON.stringify([
		itemReceipt(item),
		item.target,
		question?.messageId,
		persistedAnswer?.messageId,
		persistedAnswer?.content,
	]);
	const capability = capabilityResult?.key === capabilityKey ? capabilityResult.value : undefined;
	useEffect(() => {
		if (!continuationActions || !question) return;
		let active = true;
		let sequence = 0;
		const load = async () => {
			const next = ++sequence;
			try {
				const value = await continuationActions.capability({
					...itemReceipt(item),
					questionId: question.messageId,
				});
				if (active && next === sequence) setCapabilityResult({ key: capabilityKey, value });
			} catch {
				if (active && next === sequence)
					setCapabilityResult({
						key: capabilityKey,
						value: {
							status: "unavailable",
							reason:
								"Continuation availability could not be checked. You can still save your answer.",
						},
					});
			}
		};
		void load();
		const timer = setInterval(() => void load(), 1500);
		return () => {
			active = false;
			clearInterval(timer);
		};
	}, [continuationActions, capabilityKey, item, question]);
	const applyContinuation = useCallback(
		(input: QueueAnswerContinueInput, result: QueueAnswerContinueResult) => {
			const current = requests.current[input.id];
			if (current?.requestId !== input.requestId) return;
			const previous = current.result?.continuation.status;
			if (
				(previous === "received" && result.continuation.status !== "received") ||
				(previous === "admitted" && result.continuation.status === "uncertain")
			)
				return;
			current.result = result;
			setContinuations((all) => ({ ...all, [input.id]: { input, result } }));
			if (result.answer)
				setDrafts((all) => {
					const previous = all[input.id];
					if (!previous) return all;
					return {
						...all,
						[input.id]: { ...previous, savedAnswer: result.answer ?? undefined, saved: "Saved" },
					};
				});
		},
		[]
	);
	useEffect(() => {
		if (
			!continuationActions ||
			!continuation ||
			!continuation.result ||
			!["admitted", "uncertain"].includes(continuation.result.continuation.status)
		)
			return;
		let active = true;
		const timer = setInterval(() => {
			const input = continuation.input;
			void continuationActions
				.receipt({ ...input, answerId: continuation.result?.answer?.messageId ?? input.answerId })
				.then((result) => {
					if (active) applyContinuation(input, result);
				})
				.catch(() => {});
		}, 1500);
		return () => {
			active = false;
			clearInterval(timer);
		};
	}, [continuationActions, continuation, applyContinuation]);
	if (!question) return null;
	const saved = draft.saved || persistedAnswer?.delivery;
	const savedContent = persistedAnswer?.content ?? draft.content;
	const canReply =
		available && question.replyCapability === "mcp-inbox" && !!answer && !saved && !locked;
	const target = item.target.type === "terminal" ? item.target : null;
	const coordinator = item.context.role === "coordinator";
	const workspaceName = item.context.workspaceName.trim();
	const projectName = coordinator ? "" : (item.context.projectName?.trim() ?? "");
	const chatTitle = item.context.terminalTitle?.trim() ?? "";
	const sameName = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase();
	const location = [projectName, workspaceName]
		.filter(
			(name, index, names) => name && !names.slice(0, index).some((other) => sameName(name, other))
		)
		.join(" / ");
	const provider = target?.provider ?? item.context.provider;
	const providerLabel =
		provider === "codex"
			? "Codex"
			: provider === "claude"
				? "Claude"
				: provider === "gemini"
					? "Gemini"
					: provider === "opencode"
						? "OpenCode"
						: (provider ?? "Agent");
	const distinctChat =
		chatTitle && ![projectName, workspaceName].some((name) => sameName(chatTitle, name));

	const submit = async () => {
		if (!canReply || changed || !draft.content.trim() || running.current || !answer) return;
		running.current = true;
		setBusy(true);
		update({ error: undefined });
		try {
			const result = await answer({
				...draft.receipt,
				questionId: draft.questionId,
				content: draft.content,
			});
			if (result.status !== "saved") {
				update({
					error:
						result.reason ??
						"This question changed or is no longer available. Review the latest question before retrying.",
				});
				await refresh();
				return;
			}
			update({
				saved: result.detail || "Saved. The agent has not read this answer yet.",
				savedAnswer: {
					messageId: result.messageId,
					content: draft.content.trim(),
					delivery: "saved",
				},
				error: undefined,
			});
			// Refresh failure cannot undo a saved reply or make the send button available again.
			try {
				await refresh();
			} catch {
				/* The durable saved receipt remains visible. */
			}
		} catch (error) {
			update({
				error:
					error instanceof Error
						? error.message
						: "Could not save the answer. Your draft is preserved.",
			});
		} finally {
			running.current = false;
			setBusy(false);
		}
	};
	const continueAnswer = async () => {
		if (
			!continuationActions ||
			running.current ||
			locked ||
			changed ||
			!available ||
			capability?.status !== "available" ||
			!savedContent.trim() ||
			persistedAnswer?.delivery === "retrieved"
		)
			return;
		running.current = true;
		setBusy(true);
		const input: QueueAnswerContinueInput = {
			...draft.receipt,
			questionId: draft.questionId,
			content: savedContent,
			answerId: persistedAnswer?.messageId,
			requestId: crypto.randomUUID(),
		};
		update({});
		requests.current[item.id] = { requestId: input.requestId };
		setContinuations((all) => ({ ...all, [item.id]: { input } }));
		try {
			applyContinuation(input, await continuationActions.continue(input));
		} catch {
			applyContinuation(input, {
				answer: persistedAnswer ?? null,
				continuation: {
					status: "uncertain",
					requestId: input.requestId,
					detail:
						"Saving or continuing could not be confirmed. Check status or open the conversation; this request will not be resent automatically.",
				},
			});
		}
		try {
			await refresh();
		} catch {}
		running.current = false;
		setBusy(false);
	};
	const checkContinuation = async () => {
		if (!continuationActions || !continuation || running.current) return;
		running.current = true;
		setBusy(true);
		try {
			applyContinuation(
				continuation.input,
				await continuationActions.receipt({
					...continuation.input,
					answerId: continuation.result?.answer?.messageId ?? continuation.input.answerId,
				})
			);
		} catch {}
		running.current = false;
		setBusy(false);
	};

	return (
		<section
			aria-label="Reply to this question"
			className="my-5 space-y-3 border-y border-[var(--border-subtle)] py-4 text-[12px]"
		>
			<h3 className="font-medium">Reply to this question</h3>
			<p aria-label="Answer recipient" className="break-words text-[var(--text-secondary)]">
				Recipient: {location || (coordinator ? "Coordinator" : "Workspace")} · {providerLabel}
				{distinctChat ? ` · ${chatTitle}` : ""}
			</p>
			<details
				key={`${item.id}:${question.messageId}`}
				className="break-all text-[11px] text-[var(--text-tertiary)]"
			>
				<summary className={`cursor-pointer ${queueFocus}`}>Technical details</summary>
				<p>
					{coordinator ? "Coordinator" : "Workspace"} ID:{" "}
					{item.context.entity?.id ?? item.context.workspaceId}
				</p>
				{target ? (
					<>
						<p>Terminal ID: {target.terminalId}</p>
						<p>Provider conversation ID: {target.providerSessionId ?? "unknown"}</p>
					</>
				) : (
					<p>Exact chat unavailable</p>
				)}
				<p>Question ID: {question.messageId}</p>
			</details>
			{saved ? (
				<output className="block space-y-2">
					{changed && (
						<p role="alert">
							This answer belongs to the previous queue update. Review the current conversation
							before continuing.
						</p>
					)}
					{savedContent && (
						<p className="whitespace-pre-wrap break-words">Your answer: {savedContent}</p>
					)}
					<p>
						{persistedAnswer?.delivery === "retrieved"
							? "Retrieved by the reporting agent."
							: "Saved. The agent has not read this answer yet."}
					</p>
					<p className="text-[var(--text-secondary)]">
						{continuationActions
							? "Continue with this saved answer when the chat is ready. A received answer does not mean the task is complete."
							: "Saving an answer does not resume the task. If the agent is idle, open this chat and ask it to check its messages. Ordinary chat input does not submit an answer to this question."}
					</p>
				</output>
			) : (
				<>
					{question.replyCapability === "unavailable" && (
						<p>
							{question.unavailableReason ??
								"The exact recipient could not be verified. Sending an answer from here is unavailable."}
						</p>
					)}
					<label className="block" htmlFor={inputId}>
						Your answer
					</label>
					<textarea
						id={inputId}
						value={draft.content}
						disabled={busy || locked}
						maxLength={16000}
						rows={4}
						onChange={(event) => update({ content: event.target.value, error: undefined })}
						className={`w-full resize-y rounded-md border border-[var(--border)] bg-[var(--bg-base)] p-3 ${queueFocus}`}
					/>
					{changed && (
						<div role="alert">
							<p>
								This question changed. Your draft is preserved. Review the latest question before
								sending.
							</p>
							<button
								type="button"
								disabled={busy || locked}
								onClick={() =>
									update({
										revision: item.revision,
										receipt: itemReceipt(item),
										target: JSON.stringify(item.target),
										questionId: question.messageId,
										error: undefined,
									})
								}
								className={`mt-2 underline ${queueFocus}`}
							>
								Use reviewed question revision
							</button>
						</div>
					)}
					{draft.error && (
						<p role="alert" className="whitespace-pre-wrap break-words text-[var(--st-blocked)]">
							{draft.error}
						</p>
					)}
					<button
						type="button"
						disabled={!canReply || changed || busy || !draft.content.trim()}
						onClick={() => void submit()}
						className={`rounded-md border border-[var(--border)] px-3 py-2 disabled:opacity-40 ${queueFocus}`}
					>
						{busy ? "Saving answer…" : continuationActions ? "Save answer only" : "Send answer"}
					</button>
					<p className="text-[11px] text-[var(--text-tertiary)]">
						Saves an answer linked to this question for the reporting agent. It does not type into
						or wake a chat.
					</p>
				</>
			)}
			{continuationActions && (
				<div className="space-y-2" aria-label="Continue with answer">
					{continuation?.result && (
						<output className="block">
							{"detail" in continuation.result.continuation
								? continuation.result.continuation.detail
								: continuation.result.continuation.reason}
						</output>
					)}
					{locked ? (
						<button
							type="button"
							disabled={busy || continuation?.result?.continuation.status === "received"}
							onClick={() => void checkContinuation()}
							className={`rounded-md border border-[var(--border)] px-3 py-2 disabled:opacity-40 ${queueFocus}`}
						>
							{busy
								? "Checking…"
								: continuation?.result?.continuation.status === "received"
									? "Answer received"
									: "Check continuation status"}
						</button>
					) : (
						persistedAnswer?.delivery !== "retrieved" && (
							<button
								type="button"
								disabled={
									busy ||
									changed ||
									!available ||
									capability?.status !== "available" ||
									!savedContent.trim()
								}
								onClick={() => void continueAnswer()}
								className={`rounded-md border border-[var(--border)] px-3 py-2 disabled:opacity-40 ${queueFocus}`}
							>
								{busy ? "Continuing…" : saved ? "Continue with saved answer" : "Send & continue"}
							</button>
						)
					)}
					{!locked && persistedAnswer?.delivery !== "retrieved" && (
						<p className="text-[11px] text-[var(--text-tertiary)]">
							{capability?.status === "unavailable"
								? capability.reason
								: (capability?.detail ?? "Checking whether this chat can continue…")}
						</p>
					)}
				</div>
			)}
		</section>
	);
}
