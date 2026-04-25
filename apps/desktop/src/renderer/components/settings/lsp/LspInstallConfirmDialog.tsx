import { useEffect, useState } from "react";

interface LspInstallConfirmDialogProps {
	configId: string;
	displayName: string;
	candidateBinaries: string[];
	initialPrompt: string;
	loading?: boolean;
	error?: string | null;
	onConfirm: (finalPrompt: string) => void;
	onCancel: () => void;
}

export function LspInstallConfirmDialog({
	configId,
	displayName,
	candidateBinaries,
	initialPrompt,
	loading,
	error,
	onConfirm,
	onCancel,
}: LspInstallConfirmDialogProps) {
	const [prompt, setPrompt] = useState(initialPrompt);

	useEffect(() => {
		setPrompt(initialPrompt);
	}, [initialPrompt]);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onCancel();
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [onCancel]);

	const disabled = loading || prompt.trim().length === 0;

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--scrim)] backdrop-blur-sm"
			onClick={(e) => {
				if (e.target === e.currentTarget) onCancel();
			}}
			onKeyDown={() => {}}
			role="presentation"
		>
			<div className="flex max-h-[85vh] w-[640px] flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)] shadow-[var(--shadow-md)]">
				<div className="shrink-0 border-b border-[var(--border)] px-5 py-4">
					<h2 className="text-[15px] font-semibold text-[var(--text)]">
						Launch install agent for {displayName}
					</h2>
					<p className="mt-1 text-[11px] text-[var(--text-tertiary)]">
						A new terminal will open and run your configured AI CLI with the prompt below. The agent
						will inspect your system, ask which package manager to use, and run the install command
						you approve.
					</p>
				</div>

				<div className="flex-1 overflow-y-auto px-5 py-4">
					<div className="mb-3 rounded-[6px] border border-[#d97706]/40 bg-[#d97706]/10 px-3 py-2">
						<div className="text-[11px] font-semibold text-[#f59e0b]">Run at your own risk</div>
						<div className="mt-1 text-[11px] text-[var(--text-secondary)]">
							The agent can execute shell commands on your machine. Review the prompt below and any
							commands the agent proposes before approving them. You remain responsible for what
							runs.
						</div>
					</div>

					<div className="mb-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
						<span className="text-[var(--text-tertiary)]">Server id</span>
						<code className="font-mono text-[var(--text)]">{configId}</code>
						<span className="text-[var(--text-tertiary)]">Candidate binaries</span>
						<code className="font-mono text-[var(--text)]">{candidateBinaries.join(", ")}</code>
					</div>

					<label
						htmlFor="lsp-install-prompt"
						className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]"
					>
						Prompt (editable)
					</label>
					<textarea
						id="lsp-install-prompt"
						value={prompt}
						onChange={(e) => setPrompt(e.target.value)}
						spellCheck={false}
						className="h-[280px] w-full resize-y rounded-[6px] border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 font-mono text-[11px] text-[var(--text)] focus:outline-none"
					/>

					{error && (
						<div className="mt-3 rounded-[6px] border border-[#dc2626]/40 bg-[#dc2626]/10 px-3 py-2 text-[11px] text-[#f87171]">
							{error}
						</div>
					)}
				</div>

				<div className="flex shrink-0 items-center justify-end gap-2 border-t border-[var(--border)] px-5 py-3">
					<button
						type="button"
						onClick={onCancel}
						disabled={loading}
						className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-[6px] text-[12px] text-[var(--text-secondary)] hover:text-[var(--text)] disabled:opacity-40"
					>
						Cancel
					</button>
					<button
						type="button"
						onClick={() => onConfirm(prompt)}
						disabled={disabled}
						className="rounded-[var(--radius-sm)] bg-[var(--accent)] px-4 py-[6px] text-[12px] font-medium text-[var(--accent-foreground)] hover:opacity-90 disabled:opacity-40"
					>
						{loading ? "Starting…" : "Run in terminal"}
					</button>
				</div>
			</div>
		</div>
	);
}
