import type { MouseEvent, ReactNode } from "react";

interface RepoGroupProps {
	name: string;
	isActive: boolean;
	isExpanded: boolean;
	count?: number;
	onToggle?: () => void;
	onContextMenu?: (e: MouseEvent) => void;
	subTitle?: ReactNode;
	rightContent?: ReactNode;
	children?: ReactNode;
}

/**
 * Presentational chrome for a repo group in the left sidebar.
 * Used by both `ProjectItem` (Repos tab) and `PullRequestGroup` (PRs tab).
 * The header is always a filled, bordered box so repo boundaries are obvious;
 * the active repo (the one holding the active worktree / active group) gets a
 * brighter box.
 */
export function RepoGroup({
	name,
	isActive,
	isExpanded,
	count,
	onToggle,
	onContextMenu,
	subTitle,
	rightContent,
	children,
}: RepoGroupProps) {
	return (
		<div>
			<div className="flex items-center">
				<button
					type="button"
					onClick={onToggle}
					onContextMenu={onContextMenu}
					className={[
						"flex min-w-0 flex-1 cursor-pointer items-center gap-2 border px-3 py-2",
						"rounded-[8px] text-left transition-all duration-[120ms]",
						isActive
							? "border-[var(--border-active)] bg-[var(--bg-overlay)]"
							: "border-[var(--border-subtle)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-overlay)]",
					].join(" ")}
				>
					<div className="min-w-0 flex-1">
						<div className="truncate text-[13px] font-semibold text-[var(--text)]">{name}</div>
						{subTitle}
					</div>

					{count != null && (
						<span className="shrink-0 rounded-[9px] bg-[var(--bg-overlay)] px-[7px] py-[1px] text-[10px] font-semibold text-[var(--text-tertiary)]">
							{count}
						</span>
					)}

					<svg
						aria-hidden="true"
						width="10"
						height="10"
						viewBox="0 0 10 10"
						fill="none"
						className={[
							"shrink-0 text-[var(--text-quaternary)] transition-transform duration-[120ms]",
							isExpanded ? "rotate-90" : "rotate-0",
						].join(" ")}
					>
						<path
							d="M3 1.5L7 5L3 8.5"
							stroke="currentColor"
							strokeWidth="1.3"
							strokeLinecap="round"
							strokeLinejoin="round"
						/>
					</svg>
				</button>

				{rightContent && <div className="flex shrink-0 items-center pr-2">{rightContent}</div>}
			</div>

			{isExpanded && children}
		</div>
	);
}
