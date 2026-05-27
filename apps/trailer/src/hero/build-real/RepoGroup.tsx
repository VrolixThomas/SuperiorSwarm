// Mirrors apps/desktop/src/renderer/components/RepoGroup.tsx. Static, no handlers.

import type { ReactNode } from "react";

interface RepoGroupProps {
	name: string;
	isActive: boolean;
	isExpanded: boolean;
	subTitle?: ReactNode;
	rightContent?: ReactNode;
	children?: ReactNode;
}

export function RepoGroup({
	name,
	isActive,
	isExpanded,
	subTitle,
	rightContent,
	children,
}: RepoGroupProps) {
	const showActiveChrome = isActive && isExpanded;

	return (
		<div
			className={showActiveChrome ? "rounded-[2px] border-l-2 border-[var(--accent-subtle)]" : ""}
		>
			<div className="flex items-center">
				<button
					type="button"
					className={[
						"flex min-w-0 flex-1 items-center gap-2 border-none px-3 py-1.5 cursor-pointer",
						"transition-all duration-[120ms] text-left",
						showActiveChrome ? "rounded-r-[8px] rounded-l-none" : "rounded-[8px]",
						isActive ? "text-[var(--text)]" : "text-[var(--text-quaternary)]",
						showActiveChrome
							? "bg-[var(--bg-elevated)]"
							: "bg-transparent hover:bg-[var(--bg-elevated)]",
					].join(" ")}
				>
					<div className="min-w-0 flex-1">
						<div className="truncate text-[13px] font-semibold">{name}</div>
						{subTitle}
					</div>

					<svg
						aria-hidden="true"
						width="10"
						height="10"
						viewBox="0 0 10 10"
						fill="none"
						className={[
							"shrink-0 transition-transform duration-[120ms]",
							isExpanded ? "rotate-90" : "rotate-0",
							"text-[var(--text-quaternary)]",
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
