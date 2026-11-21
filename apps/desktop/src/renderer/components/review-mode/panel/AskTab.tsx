import { useEffect, useRef, useState } from "react";
import type { AskMessage, CodeReference } from "../../../../shared/review-path-types";
import { MarkdownRenderer } from "../../MarkdownRenderer";

export interface AskTabProps {
	messages: AskMessage[];
	anchor?: AskMessage["anchor"] | null;
	available: boolean;
	onSend: (text: string, anchor?: AskMessage["anchor"]) => void;
	onReference: (ref: CodeReference) => void;
	onAddComment?: (body: string, anchor: NonNullable<AskMessage["anchor"]>) => void;
	initialQuestion?: string;
}

export function AskTab({
	messages,
	anchor,
	available,
	onSend,
	onReference,
	onAddComment,
	initialQuestion = "",
}: AskTabProps) {
	const [question, setQuestion] = useState(initialQuestion);
	const [copyStatus, setCopyStatus] = useState("");
	const input = useRef<HTMLTextAreaElement>(null);
	useEffect(() => {
		setQuestion(initialQuestion);
		if (available) input.current?.focus();
	}, [initialQuestion, available]);
	const send = () => {
		if (!available || !question.trim()) return;
		onSend(question.trim(), anchor ?? undefined);
		setQuestion("");
	};
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="min-h-0 flex-1 overflow-y-auto p-4">
				{anchor && (
					<div
						className="mb-4 max-w-full truncate rounded-full bg-[var(--bg-elevated)] px-2 py-1 font-mono text-[11px] text-[var(--text-secondary)]"
						title={anchor.path}
					>
						{anchor.path.split("/").pop()} · {anchor.startLine}–{anchor.endLine}
					</div>
				)}
				{!available && (
					<p className="text-[13px] text-[var(--text-tertiary)]">
						Agent not connected yet. Questions will be available when the reading-path agent is
						connected.
					</p>
				)}
				{messages.map((message) => (
					<article
						key={message.id}
						className={`mb-5 text-[13px] ${message.role === "user" ? "ml-5 rounded-lg bg-[var(--bg-overlay)] p-3" : "text-[var(--text-secondary)]"}`}
					>
						<MarkdownRenderer content={message.text} skipHtml />
						{message.refs?.map((ref, i) => (
							<button
								type="button"
								data-reference
								key={`${ref.path}:${ref.line}:${i}`}
								title={ref.description}
								onClick={() => onReference(ref)}
								className="mr-2 mt-2 max-w-full truncate font-mono text-[12px] text-[var(--accent-hover)]"
							>
								{ref.path.split("/").pop()}:{ref.line}
							</button>
						))}
						{message.role === "agent" && (
							<div className="mt-3 flex items-center gap-3 text-[12px]">
								{message.anchor && onAddComment && (
									<button
										type="button"
										data-add-comment
										onClick={() => {
											if (message.anchor) onAddComment(message.text, message.anchor);
										}}
										className="rounded-md border border-[var(--border)] px-2 py-1"
									>
										Add as comment
									</button>
								)}
								<button
									type="button"
									onClick={async () => {
										try {
											await navigator.clipboard.writeText(message.text);
											setCopyStatus("Copied");
										} catch {
											setCopyStatus("Could not copy");
										}
									}}
									className="text-[var(--text-secondary)]"
								>
									Copy
								</button>
							</div>
						)}
					</article>
				))}
				<output className="text-[11px] text-[var(--text-tertiary)]">{copyStatus}</output>
			</div>
			<div className="flex shrink-0 items-end gap-2 border-t border-[var(--border-subtle)] p-3">
				<textarea
					ref={input}
					aria-label="Ask a follow-up"
					placeholder={available ? "Ask a follow-up…" : "Agent not connected yet"}
					disabled={!available}
					value={question}
					onChange={(e) => setQuestion(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
							e.preventDefault();
							send();
						}
					}}
					rows={3}
					className="min-w-0 flex-1 resize-none rounded-lg border border-[var(--border-active)] bg-[var(--bg-base)] p-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-60"
				/>
				<button
					type="button"
					aria-label="Send question"
					disabled={!available || !question.trim()}
					onClick={send}
					className="rounded-lg bg-[var(--accent)] px-3 py-2 text-[13px] text-[var(--accent-foreground)] disabled:opacity-40"
				>
					↑
				</button>
			</div>
		</div>
	);
}
