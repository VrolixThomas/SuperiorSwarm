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
		</div>
	);
}
