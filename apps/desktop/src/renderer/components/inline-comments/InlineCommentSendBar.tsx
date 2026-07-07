import { useState } from "react";
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
	const utils = trpc.useUtils();
	const markSentMut = trpc.inlineComments.markSent.useMutation({
		onSuccess: () => utils.inlineComments.list.invalidate({ workspaceId }),
	});

	if (comments.length === 0) return null;

	const terminalTabs = useTabStore
		.getState()
		.getTabsByWorkspace(workspaceId)
		.filter((t) => t.kind === "terminal");

	function handleSend(terminalId: string) {
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
		window.electron.terminal.write(terminalId, bracketedPasteSubmit(prompt));
		markSentMut.mutate({ ids: comments.map((c) => c.id) });
		setPickerOpen(false);
	}

	return (
		<div className="relative flex shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-1">
			<span className="text-[11px] text-[var(--text-secondary)]">
				{comments.length} {comments.length === 1 ? "comment" : "comments"} pending
			</span>
			<div className="flex-1" />
			<button
				type="button"
				onClick={() => setPickerOpen((o) => !o)}
				className="rounded-[4px] bg-[var(--accent)] px-2 py-0.5 text-[10px] font-medium text-[var(--accent-foreground)] hover:opacity-80"
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
								onClick={() => handleSend(t.id)}
								className="flex w-full flex-col px-3 py-1.5 text-left hover:bg-[var(--bg-overlay)]"
							>
								<span className="text-[11px] text-[var(--text-secondary)]">{t.title}</span>
								<span className="truncate font-mono text-[10px] text-[var(--text-quaternary)]">
									{t.kind === "terminal" ? t.cwd : ""}
								</span>
							</button>
						))
					)}
				</div>
			)}
		</div>
	);
}
