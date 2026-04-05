import { useCallback, useEffect, useRef, useState } from "react";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";

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

export function QuickActionPopover({
	projectId,
	repoPath,
	onClose,
	editAction,
}: QuickActionPopoverProps) {
	const [label, setLabel] = useState(editAction?.label ?? "");
	const [command, setCommand] = useState(editAction?.command ?? "");
	const [cwd, setCwd] = useState(editAction?.cwd ?? "");
	const [shortcut, setShortcut] = useState(editAction?.shortcut ?? "");
	const [scope, setScope] = useState<"global" | "repo">(
		editAction ? (editAction.projectId === null ? "global" : "repo") : "repo"
	);
	const labelRef = useRef<HTMLInputElement>(null);

	const activeWorkspaceId = useTabStore((s) => s.activeWorkspaceId);
	const addTerminalTab = useTabStore((s) => s.addTerminalTab);

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
		labelRef.current?.focus();
	}, []);

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

	return (
		<div className="fixed inset-0 z-50" onClick={onClose}>
			<div
				className="absolute right-4 top-12 w-[280px] rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-3 shadow-xl"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="mb-3 text-[13px] font-medium text-[var(--text)]">
					{editAction ? "Edit Quick Action" : "New Quick Action"}
				</div>

				<div className="flex flex-col gap-2">
					{/* Label */}
					<div>
						<div className="mb-1 text-[10px] uppercase text-[var(--text-quaternary)]">Label</div>
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
						<div className="mb-1 text-[10px] uppercase text-[var(--text-quaternary)]">Command</div>
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
							Directory <span className="normal-case text-[var(--text-quaternary)]">(optional)</span>
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
							Shortcut <span className="normal-case text-[var(--text-quaternary)]">(optional)</span>
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
					</div>

					{/* Scope Toggle */}
					<div>
						<div className="mb-1 text-[10px] uppercase text-[var(--text-quaternary)]">Scope</div>
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

				{/* Ask agent */}
				{!editAction && (
					<div className="mt-2 border-t border-[var(--border-subtle)] pt-2">
						<button
							type="button"
							onClick={() => {
								if (!activeWorkspaceId) return;
								launchAgent.mutate(
									{ projectId, repoPath },
									{
										onSuccess: ({ launchScript }) => {
											const tabId = addTerminalTab(
												activeWorkspaceId,
												repoPath,
												"Setup Quick Actions",
											);
											setTimeout(() => {
												window.electron.terminal.write(tabId, `bash '${launchScript}'\n`);
											}, 300);
											onClose();
										},
									},
								);
							}}
							disabled={launchAgent.isPending || !activeWorkspaceId}
							className="w-full rounded bg-[var(--bg-base)] px-2 py-1.5 text-left text-[11px] text-[var(--text-secondary)] hover:bg-[rgba(255,255,255,0.06)] disabled:opacity-40"
						>
							{launchAgent.isPending ? "Launching agent..." : "Ask agent to set up commands..."}
						</button>
					</div>
				)}

				{/* Actions */}
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
			</div>
		</div>
	);
}
