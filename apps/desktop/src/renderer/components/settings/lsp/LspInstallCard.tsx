import type { LspHealthEntry } from "../../../../shared/types";

interface LspInstallCardProps {
	entry: LspHealthEntry;
	onRecheck?: () => void;
	onAskAgent?: () => void;
	rechecking?: boolean;
	askingAgent?: boolean;
}

export function LspInstallCard({
	entry,
	onRecheck,
	onAskAgent,
	rechecking,
	askingAgent,
}: LspInstallCardProps) {
	return (
		<div className="mt-2 rounded-[6px] border border-[var(--border)] bg-[var(--bg-elevated)] p-3">
			<div className="mb-2 text-[11px] text-[var(--text-secondary)]">
				Binary <code className="font-mono text-[var(--text)]">{entry.command}</code> not found on
				PATH.
			</div>

			{entry.searchedPath && (
				<details className="mb-2">
					<summary className="cursor-pointer text-[10px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]">
						Show searched PATH
					</summary>
					<div className="mt-1 break-all font-mono text-[9px] text-[var(--text-quaternary)]">
						{entry.searchedPath}
					</div>
				</details>
			)}

			<div className="mt-3 flex flex-wrap gap-2">
				{onAskAgent && (
					<ActionButton onClick={onAskAgent} disabled={askingAgent} primary>
						{askingAgent ? "Starting agent…" : "Ask agent to install"}
					</ActionButton>
				)}
				{onRecheck && (
					<ActionButton onClick={onRecheck} disabled={rechecking}>
						{rechecking ? "Checking…" : "Recheck"}
					</ActionButton>
				)}
			</div>
		</div>
	);
}

function ActionButton({
	children,
	onClick,
	disabled,
	primary,
}: {
	children: React.ReactNode;
	onClick: () => void;
	disabled?: boolean;
	primary?: boolean;
}) {
	const base = "rounded-[4px] border px-2 py-0.5 text-[10px] disabled:opacity-40 transition-colors";
	const variant = primary
		? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-foreground)] hover:opacity-90"
		: "border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]";
	return (
		<button type="button" onClick={onClick} disabled={disabled} className={`${base} ${variant}`}>
			{children}
		</button>
	);
}
