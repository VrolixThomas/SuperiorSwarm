import { useTabStore } from "../stores/tab-store";

interface OrchestratorRowProps {
	workspace: { id: string; name: string };
	colorIndex: 1 | 2 | 3;
	childCount: number;
	expanded: boolean;
	onToggle: () => void;
	activeChildName?: string;
}

export function OrchestratorRow({
	workspace,
	colorIndex,
	childCount,
	expanded,
	onToggle,
	activeChildName,
}: OrchestratorRowProps) {
	const isActive = useTabStore((s) => s.activeWorkspaceId === workspace.id);
	const isActiveByChild = !expanded && activeChildName !== undefined;
	const isAccented = isActive || isActiveByChild;

	const swatchVar = `var(--orch-${colorIndex})`;
	const pillBg = `var(--orch-${colorIndex}-bg)`;
	const pillFg = swatchVar;

	return (
		<button
			type="button"
			onClick={onToggle}
			className={[
				"relative flex w-full items-center gap-2 border-none pl-[22px] pr-3 py-[7px] cursor-pointer",
				"transition-all duration-[120ms] text-left rounded-[6px]",
				isAccented
					? "bg-[var(--accent-subtle)] hover:bg-[var(--accent-subtle)]"
					: "bg-transparent hover:bg-[var(--bg-elevated)]",
			].join(" ")}
		>
			{isAccented && (
				<span
					aria-hidden="true"
					className="absolute left-0 top-1 bottom-1 w-[3px] rounded-r-[2px] bg-[var(--accent)]"
				/>
			)}
			<span className="text-[10px] text-[var(--text-quaternary)] w-[10px] -mr-[2px]">
				{expanded ? "▾" : "▸"}
			</span>
			<span
				aria-hidden="true"
				className="h-[8px] w-[8px] rounded-[2px] shrink-0"
				style={{ background: swatchVar }}
			/>
			<span className="flex-1 min-w-0 truncate text-[13px] font-medium text-[var(--text-secondary)]">
				{workspace.name}
				{!expanded && activeChildName && (
					<span className="text-[var(--text-tertiary)]"> · {activeChildName}</span>
				)}
			</span>
			<span
				className="text-[10px] font-medium px-[7px] py-[1px] rounded-[9px] min-w-[16px] text-center"
				style={{ background: pillBg, color: pillFg }}
			>
				{childCount}
			</span>
		</button>
	);
}
