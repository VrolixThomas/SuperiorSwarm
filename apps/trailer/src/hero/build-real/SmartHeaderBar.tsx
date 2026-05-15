// Mirrors apps/desktop/src/renderer/components/SmartHeaderBar.tsx render path.
// Static — picker popover is omitted (closed state only).

import { BranchChip } from "./BranchChip";

interface Props {
	currentBranch: string;
	baseBranch: string;
	hasProject?: boolean;
}

export function SmartHeaderBar({ currentBranch, baseBranch, hasProject = true }: Props) {
	return (
		<div className="relative shrink-0 border-b border-[var(--border)]">
			<div className="flex items-center gap-1.5 px-3 py-1.5">
				{hasProject && <BranchChip branch={currentBranch} />}
				{hasProject && <span className="text-[11px] text-[var(--text-quaternary)]">→</span>}

				{!hasProject && (
					<>
						<svg
							aria-hidden="true"
							width="10"
							height="10"
							viewBox="0 0 16 16"
							fill="currentColor"
							className="shrink-0 text-[var(--text-quaternary)]"
						>
							<path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.5 2.5 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Z" />
						</svg>
						<span className="truncate text-[12px] text-[var(--text-secondary)]">
							{currentBranch}
						</span>
						<span className="text-[11px] text-[var(--text-quaternary)]">→</span>
					</>
				)}
				<button
					type="button"
					className="flex items-center gap-1 truncate rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[12px] text-[var(--text-tertiary)]"
				>
					<span className="truncate">{baseBranch}</span>
					<svg
						aria-hidden="true"
						width="8"
						height="8"
						viewBox="0 0 16 16"
						fill="currentColor"
						className="shrink-0"
					>
						<path d="M4.427 7.427l3.396 3.396a.25.25 0 00.354 0l3.396-3.396A.25.25 0 0011.396 7H4.604a.25.25 0 00-.177.427z" />
					</svg>
				</button>
			</div>
		</div>
	);
}
