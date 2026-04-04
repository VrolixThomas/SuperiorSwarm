import type { BranchInfo } from "../../shared/branch-types";
import { formatRelativeTime } from "../../shared/tickets";

interface Props {
	branch: BranchInfo;
	isSelected: boolean;
	onSelect: (e: React.MouseEvent) => void;
	onContextMenu: (e: React.MouseEvent) => void;
	onActionClick: (e: React.MouseEvent) => void;
}

export function BranchRow({ branch, isSelected, onSelect, onContextMenu, onActionClick }: Props) {
	return (
		// biome-ignore lint/a11y/useSemanticElements: listbox option rows need div to hold complex content
		<div
			role="option"
			aria-selected={isSelected}
			tabIndex={0}
			onClick={onSelect}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					onSelect(e as unknown as React.MouseEvent);
				}
			}}
			onContextMenu={onContextMenu}
			className={[
				"group flex items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-[13px] transition-all duration-[var(--transition-fast)] cursor-pointer",
				isSelected ? "bg-[rgba(255,255,255,0.06)]" : "hover:bg-[rgba(255,255,255,0.04)]",
			].join(" ")}
		>
			{branch.isDefault ? (
				<svg
					aria-hidden="true"
					width="14"
					height="14"
					viewBox="0 0 24 24"
					fill="none"
					stroke="var(--color-warning)"
					strokeWidth="2"
					className="shrink-0"
				>
					<path d="m12 2 3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14l-5-4.87 6.91-1.01z" />
				</svg>
			) : (
				<svg
					aria-hidden="true"
					width="14"
					height="14"
					viewBox="0 0 24 24"
					fill="none"
					stroke="var(--text-tertiary)"
					strokeWidth="2"
					className="shrink-0"
				>
					<path d="M6 3v12" />
					<circle cx="18" cy="6" r="3" />
					<circle cx="6" cy="18" r="3" />
					<path d="M18 9a9 9 0 0 1-9 9" />
				</svg>
			)}
			<span className="min-w-0 truncate text-[var(--text)]">{branch.name}</span>
			{branch.isDefault && (
				<span className="shrink-0 rounded-[4px] bg-[rgba(255,255,255,0.04)] px-1.5 text-[10px] text-[var(--text-quaternary)]">
					default
				</span>
			)}
			{/* Local/remote indicator */}
			{branch.isLocal && !branch.isRemote && (
				<span
					className="shrink-0 rounded-[4px] bg-[rgba(255,255,255,0.04)] px-1.5 text-[10px] text-[var(--text-quaternary)]"
					title="Local only — not on remote"
				>
					local
				</span>
			)}
			{!branch.isLocal && branch.isRemote && (
				<span
					className="shrink-0 rounded-[4px] bg-[rgba(255,255,255,0.04)] px-1.5 text-[10px] text-[var(--text-quaternary)]"
					title="Remote only — not checked out locally"
				>
					remote
				</span>
			)}
			{branch.hasWorkspace && (
				<div
					className="h-[6px] w-[6px] shrink-0 rounded-full bg-[var(--accent)]"
					title="Has workspace"
				/>
			)}
			{/* Ahead/behind badges */}
			{branch.ahead > 0 && (
				<span className="shrink-0 rounded-full bg-[rgba(48,209,88,0.1)] px-1.5 text-[10px] text-[var(--color-success)]">
					↑{branch.ahead}
				</span>
			)}
			{branch.behind > 0 && (
				<span className="shrink-0 rounded-full bg-[rgba(255,159,10,0.1)] px-1.5 text-[10px] text-[var(--color-warning)]">
					↓{branch.behind}
				</span>
			)}
			{branch.tracking && (
				<span className="shrink-0 text-[11px] text-[var(--text-quaternary)]">
					{branch.tracking}
				</span>
			)}
			{branch.lastCommit && (
				<span className="shrink-0 text-[11px] text-[var(--text-quaternary)]">
					{formatRelativeTime(branch.lastCommit.date)}
				</span>
			)}
			<button
				type="button"
				onClick={(e) => {
					e.stopPropagation();
					onActionClick(e);
				}}
				className="ml-auto shrink-0 rounded-[var(--radius-sm)] p-0.5 opacity-0 transition-opacity duration-[var(--transition-fast)] group-hover:opacity-60 hover:!opacity-100"
			>
				<svg
					aria-hidden="true"
					width="14"
					height="14"
					viewBox="0 0 24 24"
					fill="none"
					stroke="var(--text-quaternary)"
					strokeWidth="2"
				>
					<circle cx="12" cy="12" r="1" />
					<circle cx="19" cy="12" r="1" />
					<circle cx="5" cy="12" r="1" />
				</svg>
			</button>
		</div>
	);
}

