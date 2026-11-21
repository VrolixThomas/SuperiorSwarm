import { useRef, useState } from "react";
import type {
	WorkspaceQueueAnswerInput,
	WorkspaceQueueAnswerResult,
	WorkspaceQueueItem,
} from "../../../shared/activity-queue";
import { queueFocus } from "./QueueRow";

type Draft = {
	content: string;
	revision: number;
	questionId: string;
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
	refresh,
}: {
	item: WorkspaceQueueItem;
	available: boolean;
	answer?: AnswerQuestion;
	refresh: () => Promise<unknown>;
}) {
	const [drafts, setDrafts] = useState<Record<string, Draft>>({});
	const [busy, setBusy] = useState(false);
	const running = useRef(false);
	const question = item.question;
	if (!question) return null;
	const draft = drafts[item.id] ?? {
		content: "",
		revision: item.revision,
		questionId: question.messageId,
	};
	const update = (patch: Partial<Draft>) =>
		setDrafts((all) => ({ ...all, [item.id]: { ...draft, ...patch } }));
	const changed = draft.revision !== item.revision || draft.questionId !== question.messageId;
	const saved = draft.saved || question.answer?.delivery;
	const canReply = available && question.replyCapability === "mcp-inbox" && !!answer && !saved;
	const target = item.target.type === "terminal" ? item.target : null;
	const submit = async () => {
		if (!canReply || changed || !draft.content.trim() || running.current || !answer) return;
		running.current = true;
		setBusy(true);
		update({ error: undefined });
		try {
			const result = await answer({
				id: item.id,
				revision: draft.revision,
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
				saved:
					result.detail || "Saved to the agent inbox. The agent has not retrieved this answer yet.",
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
	return (
		<section
			aria-label="Reply to this question"
			className="my-5 space-y-3 border-y border-[var(--border-subtle)] py-4 text-[12px]"
		>
			<h3 className="font-medium">Reply to this question</h3>
			<p className="break-words text-[var(--text-secondary)]">
				Recipient: {item.context.workspaceName} ·{" "}
				{item.context.terminalTitle ?? "Chat title unavailable"}
			</p>
			<p className="break-all text-[11px] text-[var(--text-tertiary)]">
				{item.context.role ?? "workspace"} {item.context.entity?.id ?? item.context.workspaceId}
				{target
					? ` · ${target.provider} · ${target.terminalId} · conversation ${target.providerSessionId ?? "unknown"}`
					: " · Exact chat unavailable"}
			</p>
			<p className="break-all text-[11px] text-[var(--text-tertiary)]">
				Question {question.messageId}
			</p>
			{saved ? (
				<output className="block space-y-2">
					{draft.content && (
						<p className="whitespace-pre-wrap break-words">Your answer: {draft.content}</p>
					)}
					<p>
						{question.answer?.delivery === "retrieved"
							? "Retrieved by the reporting agent."
							: "Saved to the agent inbox. Not yet retrieved by the agent."}
					</p>
					<p className="text-[var(--text-secondary)]">
						Saving an answer does not resume the task. If the agent is idle, open its exact chat and
						ask it to read its MCP inbox. Ordinary chat input is not a correlated answer.
					</p>
				</output>
			) : (
				<>
					{question.replyCapability === "unavailable" && (
						<p>
							{question.unavailableReason ??
								"The exact recipient could not be verified. A correlated reply is unavailable."}
						</p>
					)}
					<label className="block" htmlFor="queue-question-answer">
						Your answer
					</label>
					<textarea
						id="queue-question-answer"
						value={draft.content}
						disabled={busy}
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
								disabled={busy}
								onClick={() =>
									update({
										revision: item.revision,
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
						<p role="alert" className="text-[var(--st-blocked)]">
							{draft.error}
						</p>
					)}
					<button
						type="button"
						disabled={!canReply || changed || busy || !draft.content.trim()}
						onClick={() => void submit()}
						className={`rounded-md border border-[var(--border)] px-3 py-2 disabled:opacity-40 ${queueFocus}`}
					>
						{busy ? "Saving answer…" : "Send correlated answer"}
					</button>
					<p className="text-[11px] text-[var(--text-tertiary)]">
						Saves a reply linked to this question in the reporting agent’s MCP inbox. It does not
						type into or wake a terminal.
					</p>
				</>
			)}
		</section>
	);
}
