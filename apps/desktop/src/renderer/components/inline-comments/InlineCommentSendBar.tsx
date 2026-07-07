import { useEffect, useRef, useState } from "react";
import { buildInlineCommentsPrompt } from "../../../shared/inline-comment-prompt";
import { bracketedPasteSubmit } from "../../../shared/terminal-injection";
import { useTabStore } from "../../stores/tab-store";
import { trpc } from "../../trpc/client";
import type { AnchoredComment } from "./InlineCommentLayer";

export function InlineCommentSendBar({
	workspaceId,
	comments,
}: {
	workspaceId: string;
	comments: AnchoredComment[];
}) {
	const [pickerOpen, setPickerOpen] = useState(false);
	const [sendError, setSendError] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);
	const utils = trpc.useUtils();
	const markSentMut = trpc.inlineComments.markSent.useMutation({
		onSuccess: () => utils.inlineComments.list.invalidate({ workspaceId }),
	});

	useEffect(() => {
		if (!pickerOpen) return;
		function onMouseDown(e: MouseEvent) {
			if (rootRef.current && e.target instanceof Node && rootRef.current.contains(e.target)) {
				return;
			}
			setPickerOpen(false);
		}
		function onKeyDown(e: KeyboardEvent) {
			if (e.key === "Escape") setPickerOpen(false);
		}
		document.addEventListener("mousedown", onMouseDown);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("mousedown", onMouseDown);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [pickerOpen]);

	if (comments.length === 0) return null;

	const terminalTabs = useTabStore
		.getState()
		.getTabsByWorkspace(workspaceId)
		.filter((t) => t.kind === "terminal");

	async function handleSend(terminalId: string) {
		if (markSentMut.isPending) return;
		const prompt = buildInlineCommentsPrompt(
			comments.map((c) => ({
				filePath: c.filePath,
				startLine: c.displayStartLine,
				endLine: c.displayEndLine,
				codeSnapshot: c.codeSnapshot,
				body: c.body,
				outdated: c.outdated,
			}))
		);
		try {
			await window.electron.terminal.write(terminalId, bracketedPasteSubmit(prompt));
			markSentMut.mutate({ ids: comments.map((c) => c.id) });
			setSendError(false);
			setPickerOpen(false);
		} catch {
			setSendError(true);
		}
	}

	return (
		<div
			ref={rootRef}
			className="relative flex shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-1"
		>
			<span className="text-[11px] text-[var(--text-secondary)]">
				{comments.length} {comments.length === 1 ? "comment" : "comments"} pending
			</span>
			{sendError && (
				<span className="text-[11px] text-[var(--danger)]">Send failed - terminal unavailable</span>
			)}
			<div className="flex-1" />
			<button
				type="button"
				disabled={markSentMut.isPending}
				onClick={() => {
					setSendError(false);
					setPickerOpen((o) => !o);
				}}
				className="rounded-[4px] bg-[var(--accent)] px-2 py-0.5 text-[10px] font-medium text-[var(--accent-foreground)] hover:opacity-80 disabled:opacity-50"
			>
				Send to agent
			</button>
			{pickerOpen && (
				<div className="absolute right-2 top-full z-50 mt-1 w-64 rounded-[6px] border border-[var(--border)] bg-[var(--bg-surface)] py-1 shadow-lg">
					{terminalTabs.length === 0 ? (
						<div className="px-3 py-2 text-[11px] text-[var(--text-quaternary)]">
							No open chats in this workspace. Open a terminal running your agent first.
						</div>
					) : (
						terminalTabs.map((t) => (
							<button
								key={t.id}
								type="button"
								disabled={markSentMut.isPending}
								onClick={() => handleSend(t.id)}
								className="flex w-full flex-col px-3 py-1.5 text-left hover:bg-[var(--bg-overlay)] disabled:opacity-50"
							>
								<span className="text-[11px] text-[var(--text-secondary)]">{t.title}</span>
								<span className="truncate font-mono text-[10px] text-[var(--text-quaternary)]">
									{t.cwd}
								</span>
							</button>
						))
					)}
				</div>
			)}
		</div>
	);
}
