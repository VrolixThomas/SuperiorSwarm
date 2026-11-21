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
	inputId = "queue-question-answer",
}: {
	item: WorkspaceQueueItem;
	available: boolean;
	answer?: AnswerQuestion;
	refresh: () => Promise<unknown>;
	inputId?: string;
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
	const savedContent = question.answer?.content ?? draft.content;
	const canReply = available && question.replyCapability === "mcp-inbox" && !!answer && !saved;
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
				saved: result.detail || "Saved. The agent has not read this answer yet.",
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
					{savedContent && (
						<p className="whitespace-pre-wrap break-words">Your answer: {savedContent}</p>
					)}
					<p>
						{question.answer?.delivery === "retrieved"
							? "Retrieved by the reporting agent."
							: "Saved. The agent has not read this answer yet."}
					</p>
					<p className="text-[var(--text-secondary)]">
						Saving an answer does not resume the task. If the agent is idle, open this chat and ask
						it to check its messages. Ordinary chat input does not submit an answer to this
						question.
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
						{busy ? "Saving answer…" : "Send answer"}
					</button>
					<p className="text-[11px] text-[var(--text-tertiary)]">
						Saves an answer linked to this question for the reporting agent. It does not type into
						or wake a chat.
					</p>
				</>
			)}
		</section>
	);
}
