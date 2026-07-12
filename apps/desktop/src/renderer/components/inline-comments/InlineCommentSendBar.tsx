import { useEffect, useRef, useState } from "react";
import type { AgentSessionInfo } from "../../../shared/agent-launch-types";
import type { CliPresetName } from "../../../shared/cli-preset";
import { buildInlineCommentsPrompt } from "../../../shared/inline-comment-prompt";
import { bracketedPasteSubmit } from "../../../shared/terminal-injection";
import { useTabStore } from "../../stores/tab-store";
import { trpc } from "../../trpc/client";
import type { AnchoredComment } from "./InlineCommentLayer";

// Renderer must not import main-process modules (e.g. CLI_PRESETS from
// src/main/ai-review/cli-presets.ts), so display labels are hardcoded here.
const CLI_LABELS: Record<CliPresetName, string> = {
	claude: "Claude Code",
	codex: "Codex",
	gemini: "Gemini CLI",
	opencode: "OpenCode",
};

function relativeTime(epochMs: number): string {
	const diffMs = Date.now() - epochMs;
	const minutes = Math.round(diffMs / 60_000);
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.round(hours / 24);
	return `${days}d ago`;
}

export function InlineCommentSendBar({
	workspaceId,
	comments,
}: {
	workspaceId: string;
	comments: AnchoredComment[];
}) {
	const [pickerOpen, setPickerOpen] = useState(false);
	const [sendError, setSendError] = useState(false);
	const [sending, setSending] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);
	const utils = trpc.useUtils();
	const markSentMut = trpc.inlineComments.markSent.useMutation({
		onSuccess: () => utils.inlineComments.list.invalidate({ workspaceId }),
	});

	const installedQ = trpc.agentLaunch.installedClis.useQuery(undefined, {
		enabled: pickerOpen,
		staleTime: Number.POSITIVE_INFINITY,
	});
	const sessionsQ = trpc.agentLaunch.listSessions.useQuery(
		{ workspaceId },
		{ enabled: pickerOpen, staleTime: 30_000 }
	);
	const buildLaunchMut = trpc.agentLaunch.buildLaunch.useMutation();

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

	const disabled = sending || markSentMut.isPending;

	async function handleSend(terminalId: string) {
		if (sending || markSentMut.isPending) return;
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
		setSending(true);
		try {
			const delivered = await window.electron.terminal.write(
				terminalId,
				bracketedPasteSubmit(prompt)
			);
			if (delivered === false) {
				// Daemon not connected: nothing was written. Keep comments pending.
				setSendError(true);
				return;
			}
			markSentMut.mutate({ ids: comments.map((c) => c.id) });
			setSendError(false);
			setPickerOpen(false);
		} catch {
			setSendError(true);
		} finally {
			setSending(false);
		}
	}

	async function handleLaunch(cli: CliPresetName, resumeSessionId?: string) {
		if (sending || markSentMut.isPending) return;
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
		setSending(true);
		try {
			const { scriptPath, cwd } = await buildLaunchMut.mutateAsync({
				workspaceId,
				cli,
				prompt,
				resumeSessionId,
			});
			const title = resumeSessionId ? `${cli}: resumed session` : `${cli}: review comments`;
			const store = useTabStore.getState();
			store.setActiveWorkspace(workspaceId, cwd);
			const tabId = store.addTerminalTab(workspaceId, cwd, title);
			// Guarantee the PTY exists before writing: the daemon silently drops
			// writes to unknown ids. A duplicate create from the Terminal component
			// mount becomes an attach (ipc.ts) and replaces the data callback.
			await window.electron.terminal.create(tabId, cwd, workspaceId);
			const delivered = await window.electron.terminal.write(
				tabId,
				`bash '${scriptPath.replace(/'/g, "'\\''")}'\n`
			);
			if (delivered === false) {
				setSendError(true);
				return;
			}
			markSentMut.mutate({ ids: comments.map((c) => c.id) });
			setSendError(false);
			setPickerOpen(false);
		} catch {
			setSendError(true);
		} finally {
			setSending(false);
		}
	}

	const installedClis = installedQ.data ?? [];
	const sessions = sessionsQ.data ?? [];
	const showEmptyState =
		terminalTabs.length === 0 &&
		installedClis.length === 0 &&
		sessions.length === 0 &&
		!sessionsQ.isLoading;

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
				disabled={disabled}
				onClick={() => {
					setSendError(false);
					setPickerOpen((o) => !o);
				}}
				className="rounded-[4px] bg-[var(--accent)] px-2 py-0.5 text-[10px] font-medium text-[var(--accent-foreground)] hover:opacity-80 disabled:opacity-50"
			>
				Send to agent
			</button>
			{pickerOpen && (
				<div className="absolute right-2 top-full z-50 mt-1 max-h-96 w-64 overflow-y-auto rounded-[6px] border border-[var(--border)] bg-[var(--bg-surface)] py-1 shadow-lg">
					{showEmptyState ? (
						<div className="px-3 py-2 text-[11px] text-[var(--text-quaternary)]">
							No open chats in this workspace. Open a terminal running your agent first.
						</div>
					) : (
						<>
							{terminalTabs.length > 0 && (
								<>
									<div className="px-3 py-1 text-[10px] uppercase tracking-wider text-[var(--text-quaternary)]">
										Open terminals
									</div>
									{terminalTabs.map((t) => (
										<button
											key={t.id}
											type="button"
											disabled={disabled}
											onClick={() => handleSend(t.id)}
											className="flex w-full flex-col px-3 py-1.5 text-left hover:bg-[var(--bg-overlay)] disabled:opacity-50"
										>
											<span className="text-[11px] text-[var(--text-secondary)]">{t.title}</span>
											<span className="truncate font-mono text-[10px] text-[var(--text-quaternary)]">
												{t.cwd}
											</span>
										</button>
									))}
								</>
							)}
							{installedClis.length > 0 && (
								<>
									<div className="px-3 py-1 text-[10px] uppercase tracking-wider text-[var(--text-quaternary)]">
										New agent
									</div>
									{installedClis.map((cli) => (
										<button
											key={cli}
											type="button"
											disabled={disabled}
											onClick={() => handleLaunch(cli)}
											className="flex w-full flex-col px-3 py-1.5 text-left hover:bg-[var(--bg-overlay)] disabled:opacity-50"
										>
											<span className="text-[11px] text-[var(--text-secondary)]">
												{CLI_LABELS[cli]}
											</span>
										</button>
									))}
								</>
							)}
							{(sessionsQ.isLoading || sessions.length > 0) && (
								<>
									<div className="px-3 py-1 text-[10px] uppercase tracking-wider text-[var(--text-quaternary)]">
										Resume session
									</div>
									{sessionsQ.isLoading ? (
										<div className="px-3 py-1.5 text-[11px] text-[var(--text-quaternary)]">
											Loading sessions...
										</div>
									) : (
										sessions.map((s: AgentSessionInfo) => (
											<button
												key={`${s.cli}-${s.sessionId}`}
												type="button"
												disabled={disabled}
												onClick={() => handleLaunch(s.cli, s.sessionId)}
												className="flex w-full flex-col px-3 py-1.5 text-left hover:bg-[var(--bg-overlay)] disabled:opacity-50"
											>
												<span className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
													<span className="truncate">{s.label}</span>
												</span>
												<span className="flex items-center gap-1.5 text-[10px] text-[var(--text-quaternary)]">
													<span className="rounded-[3px] border border-[var(--border)] px-1 uppercase tracking-wide">
														{s.cli}
													</span>
													<span>{relativeTime(s.lastActiveAt)}</span>
												</span>
											</button>
										))
									)}
								</>
							)}
						</>
					)}
				</div>
			)}
		</div>
	);
}
