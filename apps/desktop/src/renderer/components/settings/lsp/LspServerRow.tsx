interface LspServerRowProps {
	name: string;
	command: string;
	available: boolean;
	installHint?: string;
	startupError?: string;
	dimmed?: boolean;
	rightSlot: React.ReactNode;
}

export function LspServerRow({
	name,
	command,
	available,
	installHint,
	startupError,
	dimmed,
	rightSlot,
}: LspServerRowProps) {
	return (
		<div
			className="flex items-start justify-between gap-3 px-4 py-3"
			style={dimmed ? { opacity: 0.5 } : undefined}
		>
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<span className="text-[13px] font-medium text-[var(--text)]">{name}</span>
					<span
						className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
							available
								? "bg-[rgba(48,209,88,0.15)] text-[#30d158]"
								: "bg-[rgba(255,214,10,0.15)] text-[#ffd60a]"
						}`}
					>
						{available ? "Installed" : "Missing"}
					</span>
				</div>
				<div className="truncate font-mono text-[10px] text-[var(--text-quaternary)]">
					{command}
				</div>
				{!available && installHint && (
					<div className="mt-1 font-mono text-[10px] text-[var(--text-tertiary)]">
						{installHint}
					</div>
				)}
				{startupError && (
					<div className="mt-1 max-h-[60px] overflow-y-auto whitespace-pre-wrap font-mono text-[10px] text-[#ff453a]">
						{startupError}
					</div>
				)}
			</div>
			<div className="shrink-0">{rightSlot}</div>
		</div>
	);
}
