import { DIFF_PANEL } from "./mock-data";

/**
 * Right-hand diff panel — mirrors the real DiffPanel "Changes" tab
 * (apps/desktop/src/renderer/components/DiffPanel.tsx): icon tab header,
 * SmartHeaderBar (branch → base), BranchChanges card, CommittedStack.
 * Always-open (no collapse toggle) per the marketing mock.
 */
export function DiffPanelView() {
	return (
		<div className="flex h-full flex-col overflow-hidden bg-app-bg-surface">
			<PanelHeader />
			<SmartHeaderBar />
			<div className="flex-1 overflow-y-auto">
				<BranchChanges />
				<CommittedStack />
			</div>
		</div>
	);
}

/* ── Panel header — 4 icon tabs (Changes active) + close X ───────────────── */

const TAB_ICONS = {
	changes: (
		<svg
			width="14"
			height="14"
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.5"
			strokeLinecap="round"
			aria-hidden="true"
		>
			<path d="M4 6h8M4 10h5" />
			<circle cx="13" cy="10" r="1.5" fill="currentColor" stroke="none" />
		</svg>
	),
	files: (
		<svg
			width="14"
			height="14"
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.5"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<path d="M2 3h5l2 2h5v8H2z" />
		</svg>
	),
	comments: (
		<svg
			width="14"
			height="14"
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.5"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<path d="M3 3h10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H6l-3 3V4a1 1 0 0 1 1-1z" />
		</svg>
	),
	fixes: (
		<svg
			width="14"
			height="14"
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.5"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<path d="M6 2l1 3 3 1-3 1-1 3-1-3-3-1 3-1zM11 8l.5 1.5L13 10l-1.5.5L11 12l-.5-1.5L9 10l1.5-.5z" />
		</svg>
	),
} as const;

function PanelHeader() {
	const tabs = [
		{ key: "changes", label: "Changes" },
		{ key: "files", label: "Files" },
		{ key: "comments", label: "Comments" },
		{ key: "fixes", label: "Fixes" },
	] as const;

	return (
		<div className="flex shrink-0 items-center gap-2 border-b border-app-border px-3 py-2">
			<div className="flex rounded-[6px] bg-app-bg-base p-0.5">
				{tabs.map((t) => (
					<span
						key={t.key}
						title={t.label}
						className={[
							"flex items-center gap-1 rounded-[4px] px-2 py-1 transition-all duration-[120ms]",
							t.key === "changes"
								? "bg-app-bg-elevated text-app-text-secondary shadow-[0_1px_2px_rgba(0,0,0,0.3)]"
								: "text-app-text-quaternary",
						].join(" ")}
					>
						{TAB_ICONS[t.key]}
					</span>
				))}
			</div>
			<div className="flex-1" />
			<span className="flex h-5 w-5 items-center justify-center rounded-[5px] text-app-text-quaternary">
				<svg
					width="10"
					height="10"
					viewBox="0 0 10 10"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.5"
					strokeLinecap="round"
					aria-hidden="true"
				>
					<path d="M1 1l8 8M9 1l-8 8" />
				</svg>
			</span>
		</div>
	);
}

/* ── SmartHeaderBar — branch → base picker ───────────────────────────────── */

function SmartHeaderBar() {
	return (
		<div className="shrink-0 border-b border-app-border">
			<div className="flex items-center gap-1.5 px-3 py-1.5">
				<svg
					aria-hidden="true"
					width="11"
					height="11"
					viewBox="0 0 24 24"
					fill="none"
					stroke="var(--color-app-text-secondary)"
					strokeWidth="2"
					className="shrink-0"
				>
					<path d="M6 3v12" />
					<circle cx="18" cy="6" r="3" />
					<circle cx="6" cy="18" r="3" />
					<path d="M18 9a9 9 0 0 1-9 9" />
				</svg>
				<span className="min-w-0 truncate text-[12px] text-app-text-secondary">
					{DIFF_PANEL.branch}
				</span>
				<span className="shrink-0 text-[11px] text-app-text-quaternary">{"→"}</span>
				<span className="flex shrink-0 items-center gap-1 rounded-[4px] px-1.5 py-0.5 text-[12px] text-app-text-tertiary">
					<span className="truncate">{DIFF_PANEL.baseBranch}</span>
					<svg aria-hidden="true" width="8" height="8" viewBox="0 0 16 16" fill="currentColor">
						<path d="M4.427 7.427l3.396 3.396a.25.25 0 00.354 0l3.396-3.396A.25.25 0 0011.396 7H4.604a.25.25 0 00-.177.427z" />
					</svg>
				</span>
			</div>
		</div>
	);
}

/* ── BranchChanges card ──────────────────────────────────────────────────── */

function StatusDot({ status }: { status: "added" | "modified" | "deleted" | "renamed" }) {
	const color =
		status === "added"
			? "var(--color-app-term-green)"
			: status === "deleted"
				? "var(--color-app-term-red)"
				: status === "renamed"
					? "var(--color-app-accent)"
					: "var(--color-app-term-yellow)";
	return <span className="size-1.5 shrink-0 rounded-full" style={{ background: color }} />;
}

function BranchChanges() {
	const { files, totalAdditions, totalDeletions } = DIFF_PANEL;

	return (
		<div className="mx-1.5 mt-2 overflow-hidden rounded-[8px] border border-app-border bg-app-bg-elevated shadow-[0_1px_2px_rgba(0,0,0,0.3)]">
			{/* Stats header */}
			<div className="flex w-full items-center gap-1.5 px-3 py-2 text-left">
				<span className="shrink-0 text-[10px] text-app-text-quaternary">▾</span>
				<span className="shrink-0 whitespace-nowrap text-[11px] font-medium uppercase tracking-[0.05em] text-app-text-quaternary">
					Branch Changes
				</span>
				<span className="shrink-0 whitespace-nowrap rounded-full bg-app-bg-overlay px-1.5 py-px text-[10px] text-app-text-tertiary">
					{files.length} files
				</span>
				<div className="flex-1" />
				<span className="shrink-0 whitespace-nowrap text-[11px]">
					<span style={{ color: "var(--color-app-term-green)" }}>+{totalAdditions}</span>
					<span className="mx-1 text-app-text-quaternary">/</span>
					<span style={{ color: "var(--color-app-term-red)" }}>-{totalDeletions}</span>
				</span>
			</div>

			{/* File list — grouped under top-level dir (src/) */}
			<div className="border-t border-app-border-subtle px-1 py-1">
				<button
					type="button"
					className="flex w-full items-center gap-1.5 rounded px-2 py-0.5 text-left text-[12px] text-app-text-tertiary transition-colors hover:bg-app-bg-overlay"
				>
					<span className="text-[10px]">▾</span>
					<svg
						aria-hidden="true"
						width="10"
						height="10"
						viewBox="0 0 16 16"
						fill="currentColor"
						className="shrink-0 text-app-text-quaternary"
					>
						<path d="M1.75 1A1.75 1.75 0 000 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0016 13.25v-8.5A1.75 1.75 0 0014.25 3H7.5a.25.25 0 01-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75z" />
					</svg>
					<span className="truncate">src/</span>
					<span className="ml-auto text-[10px] text-app-text-quaternary">{files.length}</span>
				</button>

				{files.map((file) => (
					<button
						key={file.path}
						type="button"
						className="flex w-full items-center gap-1.5 rounded border-l-2 border-transparent px-2 py-0.5 pl-7 text-left text-[12px] text-app-text-secondary transition-colors hover:bg-app-bg-overlay"
					>
						<StatusDot status={file.status} />
						<span className="min-w-0 flex-1 truncate">{file.name}</span>
						<span className="shrink-0 text-[10px]">
							{file.additions > 0 && (
								<span style={{ color: "var(--color-app-term-green)" }}>+{file.additions}</span>
							)}
							{file.deletions > 0 && (
								<span className="ml-0.5" style={{ color: "var(--color-app-term-red)" }}>
									-{file.deletions}
								</span>
							)}
						</span>
					</button>
				))}
			</div>
		</div>
	);
}

/* ── CommittedStack ──────────────────────────────────────────────────────── */

function CommittedStack() {
	const { commits } = DIFF_PANEL;

	return (
		<div className="flex flex-col gap-1 pb-4">
			<div className="flex items-center gap-2 px-3 py-1.5">
				<span className="text-[11px] font-medium uppercase tracking-[0.05em] text-app-text-quaternary">
					Commits
				</span>
				<span className="rounded-full bg-app-bg-overlay px-1.5 py-px text-[10px] text-app-text-tertiary">
					{commits.length}
				</span>
			</div>

			{commits.map((commit) => (
				<div
					key={commit.shortHash}
					className="mx-1.5 overflow-hidden rounded-[8px] border border-app-border bg-app-bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.3)]"
				>
					<div className="flex w-full flex-col gap-0.5 px-3 py-1.5 text-left">
						<div className="flex w-full items-center gap-2">
							<span className="shrink-0 font-mono text-[11px] text-app-text-quaternary">
								{commit.shortHash}
							</span>
							<span className="min-w-0 flex-1 truncate text-[12px] text-app-text-secondary">
								{commit.message}
							</span>
							<span className="shrink-0 text-[11px] text-app-text-quaternary">{commit.time}</span>
						</div>
						<div className="flex w-full items-center gap-2">
							<span className="text-[11px]">
								<span style={{ color: "var(--color-app-term-green)" }}>+{commit.additions}</span>
								<span className="ml-1" style={{ color: "var(--color-app-term-red)" }}>
									-{commit.deletions}
								</span>
							</span>
							<span className="text-[11px] text-app-text-quaternary">
								· {commit.files} file{commit.files !== 1 ? "s" : ""}
							</span>
							<div className="flex-1" />
							<span className="text-[10px] text-app-text-quaternary">▾</span>
						</div>
					</div>
				</div>
			))}
		</div>
	);
}
