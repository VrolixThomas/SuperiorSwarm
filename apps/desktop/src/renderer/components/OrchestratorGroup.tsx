import { Children } from "react";
import type { ReactNode } from "react";

interface OrchestratorGroupProps {
	colorIndex: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
	hasActiveChild: boolean;
	children: ReactNode;
}

export function OrchestratorGroup({
	colorIndex,
	hasActiveChild,
	children,
}: OrchestratorGroupProps) {
	const railColor = `var(--orch-${colorIndex})`;
	return (
		<div className="relative pl-[14px]">
			<span
				aria-hidden="true"
				className="absolute top-[2px] bottom-[4px] w-[2px] rounded-[2px]"
				style={{
					left: "26px",
					background: railColor,
					opacity: hasActiveChild ? 1 : 0.55,
				}}
			/>
			{children}
			{Children.count(children) === 0 && (
				<div className="pl-[36px] py-2">
					<div className="text-[11px] text-[var(--text-tertiary)] leading-snug">
						No worktrees attached.
					</div>
					<div className="text-[11px] text-[var(--text-quaternary)] leading-snug">
						Drag a worktree here, or use Attach… from a worktree's context menu.
					</div>
				</div>
			)}
		</div>
	);
}
