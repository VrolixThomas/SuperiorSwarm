import { useCallback, useEffect, useRef, useState } from "react";
import { useActionStore } from "../stores/action-store";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";
import { parseAccelerator } from "../utils/parse-accelerator";

interface QuickActionPopoverProps {
	projectId: string;
	repoPath: string;
	onClose: () => void;
	editAction?: {
		id: string;
		label: string;
		command: string;
		cwd: string | null;
		shortcut: string | null;
		projectId: string | null;
	};
}

import { buildDefaultPrompt } from "../../shared/quick-action-prompt";

type Mode = "manual" | "agent";

export function QuickActionPopover({
	projectId,
	repoPath,
	onClose,
	editAction,
}: QuickActionPopoverProps) {
	const [mode, setMode] = useState<Mode>("manual");
	const [label, setLabel] = useState(editAction?.label ?? "");
	const [command, setCommand] = useState(editAction?.command ?? "");
	const [cwd, setCwd] = useState(editAction?.cwd ?? "");
	const [shortcut, setShortcut] = useState(editAction?.shortcut ?? "");
	const [scope, setScope] = useState<"global" | "repo">(
		editAction ? (editAction.projectId === null ? "global" : "repo") : "repo",
	);
	const [agentPrompt, setAgentPrompt] = useState(buildDefaultPrompt(repoPath));
	const labelRef = useRef<HTMLInputElement>(null);
	const promptRef = useRef<HTMLTextAreaElement>(null);

	const activeWorkspaceId = useTabStore((s) => s.activeWorkspaceId);
	const addTerminalTab = useTabStore((s) => s.addTerminalTab);

	// Check for shortcut conflicts with existing actions
	const conflictingAction = (() => {
		const parsed = parseAccelerator(shortcut);
		if (!parsed) return null;
		const actions = useActionStore.getState().getAvailable();
		for (const action of actions) {
			if (!action.shortcut) continue;
			if (editAction && action.id === `quick.${editAction.id}`) continue;
			if (
				action.shortcut.key === parsed.key &&
				!!action.shortcut.meta === !!parsed.meta &&
				!!action.shortcut.shift === !!parsed.shift &&
				!!action.shortcut.alt === !!parsed.alt
			) {
				return action;
			}
		}
		return null;
	})();

	const utils = trpc.useUtils();
	const createMutation = trpc.quickActions.create.useMutation({
		onSuccess: () => {
			utils.quickActions.list.invalidate();
			onClose();
		},
	});
	const updateMutation = trpc.quickActions.update.useMutation({
		onSuccess: () => {
			utils.quickActions.list.invalidate();
			onClose();
		},
	});
	const launchAgent = trpc.quickActions.launchSetupAgent.useMutation();

	useEffect(() => {
		if (mode === "manual") {
			labelRef.current?.focus();
		} else {
			promptRef.current?.focus();
		}
	}, [mode]);

	const handleShortcutCapture = useCallback((e: React.KeyboardEvent) => {
		e.preventDefault();
		const parts: string[] = [];
		if (e.metaKey || e.ctrlKey) parts.push("CommandOrControl");
		if (e.shiftKey) parts.push("Shift");
		if (e.altKey) parts.push("Alt");
		const key = e.key;
		if (!["Meta", "Control", "Shift", "Alt"].includes(key)) {
			parts.push(key.length === 1 ? key.toUpperCase() : key);
			setShortcut(parts.join("+"));
		}
	}, []);

	function handleSave() {
		if (!label.trim() || !command.trim()) return;
		if (conflictingAction) return;
		const scopedProjectId = scope === "global" ? null : projectId;
		if (editAction) {
			updateMutation.mutate({
				id: editAction.id,
				label: label.trim(),
				command: command.trim(),
				cwd: cwd.trim() || null,
				shortcut: shortcut.trim() || null,
				projectId: scopedProjectId,
			});
		} else {
			createMutation.mutate({
				projectId: scopedProjectId,
				label: label.trim(),
				command: command.trim(),
				cwd: cwd.trim() || null,
				shortcut: shortcut.trim() || null,
			});
		}
	}

	function handleLaunchAgent() {
		if (!activeWorkspaceId) return;
		launchAgent.mutate(
			{ projectId, repoPath, prompt: agentPrompt.trim() || undefined },
			{
				onSuccess: ({ launchScript }) => {
					const tabId = addTerminalTab(activeWorkspaceId, repoPath, "Setup Quick Actions");
					setTimeout(() => {
						window.electron.terminal.write(tabId, `bash '${launchScript}'\n`);
					}, 300);
					onClose();
				},
			},
		);
	}

	return (
		<div className="fixed inset-0 z-50" onClick={onClose}>
			<div
				className="absolute right-4 top-12 w-[320px] rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl"
				onClick={(e) => e.stopPropagation()}
			>
				{/* Header with mode tabs */}
				<div className="flex items-center border-b border-[var(--border-subtle)] px-1 pt-1">
					{!editAction && (
						<>
							<button
								type="button"
								onClick={() => setMode("manual")}
								className={`relative px-3 py-2 text-[11px] font-medium transition-colors ${
									mode === "manual"
										? "text-[var(--text)]"
										: "text-[var(--text-quaternary)] hover:text-[var(--text-tertiary)]"
								}`}
							>
								Manual
								{mode === "manual" && (
									<span className="absolute bottom-0 left-3 right-3 h-[2px] rounded-full bg-[var(--accent)]" />
								)}
							</button>
							<button
								type="button"
								onClick={() => setMode("agent")}
								className={`relative px-3 py-2 text-[11px] font-medium transition-colors ${
									mode === "agent"
										? "text-[var(--text)]"
										: "text-[var(--text-quaternary)] hover:text-[var(--text-tertiary)]"
								}`}
							>
								Agent
								{mode === "agent" && (
									<span className="absolute bottom-0 left-3 right-3 h-[2px] rounded-full bg-[var(--accent)]" />
								)}
							</button>
						</>
					)}
					{editAction && (
						<div className="px-3 py-2 text-[13px] font-medium text-[var(--text)]">
							Edit Quick Action
						</div>
					)}
				</div>

				<div className="p-3">
					{/* Manual mode */}
					{mode === "manual" && (
						<>
							<div className="flex flex-col gap-2">
								{/* Label */}
								<div>
									<div className="mb-1 text-[10px] uppercase text-[var(--text-quaternary)]">
										Label
									</div>
									<input
										ref={labelRef}
										type="text"
										value={label}
										onChange={(e) => setLabel(e.target.value)}
										placeholder="Build"
										className="w-full rounded border border-[var(--border)] bg-[var(--bg-base)] px-2 py-1 text-[12px] text-[var(--text)] placeholder:text-[var(--text-quaternary)] focus:border-[var(--accent)] focus:outline-none"
									/>
								</div>

								{/* Command */}
								<div>
									<div className="mb-1 text-[10px] uppercase text-[var(--text-quaternary)]">
										Command
									</div>
									<input
										type="text"
										value={command}
										onChange={(e) => setCommand(e.target.value)}
										placeholder="bun run build"
										className="w-full rounded border border-[var(--border)] bg-[var(--bg-base)] px-2 py-1 font-mono text-[12px] text-[var(--text)] placeholder:text-[var(--text-quaternary)] focus:border-[var(--accent)] focus:outline-none"
									/>
								</div>

								{/* Working Directory */}
								<div>
									<div className="mb-1 text-[10px] uppercase text-[var(--text-quaternary)]">
										Directory{" "}
										<span className="normal-case text-[var(--text-quaternary)]">(optional)</span>
									</div>
									<input
										type="text"
										value={cwd}
										onChange={(e) => setCwd(e.target.value)}
										placeholder={repoPath}
										className="w-full rounded border border-[var(--border)] bg-[var(--bg-base)] px-2 py-1 font-mono text-[12px] text-[var(--text)] placeholder:text-[var(--text-quaternary)] focus:border-[var(--accent)] focus:outline-none"
									/>
								</div>

								{/* Shortcut */}
								<div>
									<div className="mb-1 text-[10px] uppercase text-[var(--text-quaternary)]">
										Shortcut{" "}
										<span className="normal-case text-[var(--text-quaternary)]">(optional)</span>
									</div>
									<input
										type="text"
										value={shortcut}
										onKeyDown={handleShortcutCapture}
										readOnly
										placeholder="Press a key combination..."
										className="w-full cursor-pointer rounded border border-[var(--border)] bg-[var(--bg-base)] px-2 py-1 text-[12px] text-[var(--text)] placeholder:text-[var(--text-quaternary)] focus:border-[var(--accent)] focus:outline-none"
									/>
									{shortcut && (
										<button
											type="button"
											onClick={() => setShortcut("")}
											className="mt-1 text-[10px] text-[var(--text-quaternary)] hover:text-[var(--text-secondary)]"
										>
											Clear shortcut
										</button>
									)}
									{conflictingAction && (
										<div className="mt-1 text-[11px] text-[#ff6b6b]">
											Conflicts with "{conflictingAction.label}"
										</div>
									)}
								</div>

								{/* Scope Toggle */}
								<div>
									<div className="mb-1 text-[10px] uppercase text-[var(--text-quaternary)]">
										Scope
									</div>
									<div className="flex gap-1">
										<button
											type="button"
											onClick={() => setScope("repo")}
											className={`rounded px-2.5 py-1 text-[11px] transition-colors ${
												scope === "repo"
													? "bg-[var(--accent)] text-white"
													: "bg-[var(--bg-base)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
											}`}
										>
											This repo
										</button>
										<button
											type="button"
											onClick={() => setScope("global")}
											className={`rounded px-2.5 py-1 text-[11px] transition-colors ${
												scope === "global"
													? "bg-[var(--accent)] text-white"
													: "bg-[var(--bg-base)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
											}`}
										>
											Global
										</button>
									</div>
								</div>
							</div>

							{/* Manual actions */}
							<div className="mt-3 flex items-center justify-end gap-2">
								<button
									type="button"
									onClick={onClose}
									className="rounded px-3 py-1 text-[11px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
								>
									Cancel
								</button>
								<button
									type="button"
									onClick={handleSave}
									disabled={!label.trim() || !command.trim()}
									className="rounded bg-[var(--accent)] px-3 py-1 text-[11px] text-white disabled:opacity-40"
								>
									{editAction ? "Save" : "Add"}
								</button>
							</div>
						</>
					)}

					{/* Agent mode */}
					{mode === "agent" && (
						<>
							<p className="mb-2 text-[11px] leading-relaxed text-[var(--text-tertiary)]">
								A CLI agent will explore your repo and add quick actions using the
								instructions below. You can edit them before launching.
							</p>

							{/* Editable prompt */}
							<div>
								<div className="mb-1 text-[10px] uppercase text-[var(--text-quaternary)]">
									Agent instructions
								</div>
								<textarea
									ref={promptRef}
									value={agentPrompt}
									onChange={(e) => setAgentPrompt(e.target.value)}
									rows={10}
									className="w-full resize-y rounded border border-[var(--border)] bg-[var(--bg-base)] px-2 py-1.5 font-mono text-[11px] leading-relaxed text-[var(--text-secondary)] placeholder:text-[var(--text-quaternary)] focus:border-[var(--accent)] focus:outline-none"
								/>
								<button
									type="button"
									onClick={() => setAgentPrompt(buildDefaultPrompt(repoPath))}
									className="mt-1 text-[10px] text-[var(--text-quaternary)] hover:text-[var(--text-secondary)]"
								>
									Reset to default
								</button>
							</div>

							{/* Agent actions */}
							<div className="mt-3 flex items-center justify-end gap-2">
								<button
									type="button"
									onClick={onClose}
									className="rounded px-3 py-1 text-[11px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
								>
									Cancel
								</button>
								<button
									type="button"
									onClick={handleLaunchAgent}
									disabled={launchAgent.isPending || !activeWorkspaceId || !agentPrompt.trim()}
									className="rounded bg-[var(--accent)] px-3 py-1 text-[11px] text-white disabled:opacity-40"
								>
									{launchAgent.isPending ? "Launching..." : "Launch agent"}
								</button>
							</div>
						</>
					)}
				</div>
			</div>
		</div>
	);
}
