import { Fragment, useCallback, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import type { FileTab } from "../stores/tabs";
import { useTabsStore } from "../stores/tabs";
import type { TerminalTab } from "../stores/terminal";
import { useTerminalStore } from "../stores/terminal";
import { trpc } from "../trpc/client";

// ─── Terminal tab pill ───────────────────────────────────────────────────────

function TerminalTabPill({
	tab,
	isActive,
	onSelect,
	onClose,
}: {
	tab: TerminalTab;
	isActive: boolean;
	onSelect: () => void;
	onClose: () => void;
}) {
	const closeRef = useRef<HTMLButtonElement>(null);
	const showClose = useCallback(() => {
		if (!isActive && closeRef.current) closeRef.current.style.opacity = "1";
	}, [isActive]);
	const hideClose = useCallback(() => {
		if (!isActive && closeRef.current) closeRef.current.style.opacity = "0";
	}, [isActive]);

	return (
		<div
			role="tab"
			tabIndex={0}
			aria-selected={isActive}
			onClick={onSelect}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					onSelect();
				}
			}}
			onMouseEnter={showClose}
			onMouseLeave={hideClose}
			className={`group relative flex h-[36px] max-w-[220px] shrink-0 cursor-pointer select-none items-center gap-2 rounded-[7px] pl-3 pr-2 text-[13px] transition-all duration-[120ms] ${
				isActive
					? "bg-[var(--tab-active-bg)] text-[var(--text)] shadow-[0_1px_3px_rgba(0,0,0,0.4),inset_0_0.5px_0_rgba(255,255,255,0.04)]"
					: "bg-[var(--tab-inactive-bg)] text-[var(--text-tertiary)] hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--text-secondary)]"
			}`}
			style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
		>
			{isActive && (
				<span className="absolute inset-x-2.5 bottom-0 h-[2px] rounded-full bg-[var(--accent)]" />
			)}
			<span className="shrink-0 font-mono text-[10px] text-[var(--text-quaternary)]">&gt;_</span>
			<span className="min-w-0 truncate">{tab.title}</span>
			<button
				type="button"
				ref={closeRef}
				aria-label="Close tab"
				onClick={(e) => {
					e.stopPropagation();
					onClose();
				}}
				className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[5px] border-none bg-transparent p-0 transition-all duration-[120ms] hover:bg-[var(--bg-overlay)] hover:text-[var(--text)] ${
					isActive
						? "text-[var(--text-tertiary)] opacity-100"
						: "text-[var(--text-quaternary)] opacity-0"
				}`}
			>
				<svg aria-hidden="true" width="9" height="9" viewBox="0 0 9 9" fill="none">
					<path
						d="M2 2l5 5M7 2l-5 5"
						stroke="currentColor"
						strokeWidth="1.4"
						strokeLinecap="round"
					/>
				</svg>
			</button>
		</div>
	);
}

// ─── File tab pill ───────────────────────────────────────────────────────────

function FileTabPill({
	tab,
	isActive,
	onSelect,
	onClose,
}: {
	tab: FileTab;
	isActive: boolean;
	onSelect: () => void;
	onClose: () => void;
}) {
	const closeRef = useRef<HTMLButtonElement>(null);
	const showClose = useCallback(() => {
		if (!isActive && closeRef.current) closeRef.current.style.opacity = "1";
	}, [isActive]);
	const hideClose = useCallback(() => {
		if (!isActive && closeRef.current) closeRef.current.style.opacity = "0";
	}, [isActive]);

	const isDiffFile = tab.type === "diff-file";

	return (
		<div
			role="tab"
			tabIndex={0}
			aria-selected={isActive}
			onClick={onSelect}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					onSelect();
				}
			}}
			onMouseEnter={showClose}
			onMouseLeave={hideClose}
			className={`group relative flex h-[36px] max-w-[220px] shrink-0 cursor-pointer select-none items-center gap-2 rounded-[7px] pl-3 pr-2 text-[13px] transition-all duration-[120ms] ${
				isActive
					? "bg-[var(--tab-active-bg)] text-[var(--text)] shadow-[0_1px_3px_rgba(0,0,0,0.4),inset_0_0.5px_0_rgba(255,255,255,0.04)]"
					: "bg-[var(--tab-inactive-bg)] text-[var(--text-tertiary)] hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--text-secondary)]"
			}`}
			style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
		>
			{isActive && (
				<span
					className={`absolute inset-x-2.5 bottom-0 h-[2px] rounded-full ${
						isDiffFile ? "bg-[var(--term-yellow)]" : "bg-[var(--accent)]"
					}`}
				/>
			)}
			{isDiffFile && (
				<span className="shrink-0 h-[6px] w-[6px] rounded-full bg-[var(--term-yellow)] opacity-70" />
			)}
			<span className="min-w-0 truncate">{tab.title}</span>
			<button
				type="button"
				ref={closeRef}
				aria-label="Close tab"
				onClick={(e) => {
					e.stopPropagation();
					onClose();
				}}
				className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[5px] border-none bg-transparent p-0 transition-all duration-[120ms] hover:bg-[var(--bg-overlay)] hover:text-[var(--text)] ${
					isActive
						? "text-[var(--text-tertiary)] opacity-100"
						: "text-[var(--text-quaternary)] opacity-0"
				}`}
			>
				<svg aria-hidden="true" width="9" height="9" viewBox="0 0 9 9" fill="none">
					<path
						d="M2 2l5 5M7 2l-5 5"
						stroke="currentColor"
						strokeWidth="1.4"
						strokeLinecap="round"
					/>
				</svg>
			</button>
		</div>
	);
}

// ─── Main TabBar ─────────────────────────────────────────────────────────────

export function TabBar() {
	const terminalTabs = useTerminalStore(useShallow((s) => s.getVisibleTabs()));
	const activeTerminalTabId = useTerminalStore((s) => s.activeTabId);
	const setTerminalActiveTab = useTerminalStore((s) => s.setActiveTab);
	const removeTerminalTab = useTerminalStore((s) => s.removeTab);
	const addTerminalTab = useTerminalStore((s) => s.addTab);
	const activeWorkspaceId = useTerminalStore((s) => s.activeWorkspaceId);
	const activeWorkspaceCwd = useTerminalStore((s) => s.activeWorkspaceCwd);

	const { fileTabs, activePane, closeFileTab, setActivePane } = useTabsStore();

	const detachMutation = trpc.workspaces.detachTerminal.useMutation();

	const isTerminalPaneActive = activePane.kind === "terminal";

	return (
		<div
			className="flex h-[52px] shrink-0 items-end border-b border-[var(--tab-border)] bg-[var(--bg-tab-bar)]"
			style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
		>
			<div
				role="tablist"
				className="scrollbar-hide flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto px-1 pb-[7px]"
			>
				{/* Terminal tabs */}
				{terminalTabs.map((tab, i) => {
					const isActive = isTerminalPaneActive && tab.id === activeTerminalTabId;
					const prevIsActive =
						i > 0 &&
						isTerminalPaneActive &&
						terminalTabs[i - 1]?.id === activeTerminalTabId;

					return (
						<Fragment key={tab.id}>
							{i > 0 && !isActive && !prevIsActive && (
								<div className="mx-px h-[14px] w-px shrink-0 rounded-full bg-[var(--border)]" />
							)}
							{i > 0 && (isActive || prevIsActive) && <div className="w-1 shrink-0" />}
							<TerminalTabPill
								tab={tab}
								isActive={isActive}
								onSelect={() => {
									setTerminalActiveTab(tab.id);
									setActivePane({ kind: "terminal" });
								}}
								onClose={() => {
									if (tab.workspaceId) {
										detachMutation.mutate({ workspaceId: tab.workspaceId });
									}
									removeTerminalTab(tab.id);
								}}
							/>
						</Fragment>
					);
				})}

				{/* Divider between terminal and file tabs */}
				{terminalTabs.length > 0 && fileTabs.length > 0 && (
					<div className="mx-1 h-[14px] w-px shrink-0 rounded-full bg-[var(--border)]" />
				)}

				{/* File/diff tabs */}
				{fileTabs.map((tab) => {
					const isActive =
						activePane.kind === "file" && activePane.tabId === tab.id;
					return (
						<FileTabPill
							key={tab.id}
							tab={tab}
							isActive={isActive}
							onSelect={() => setActivePane({ kind: "file", tabId: tab.id })}
							onClose={() => closeFileTab(tab.id)}
						/>
					);
				})}
			</div>

			{/* New terminal button */}
			<div className="shrink-0 pb-[7px] pr-2">
				<button
					type="button"
					aria-label="New terminal tab"
					disabled={!activeWorkspaceId}
					onClick={() => {
						if (!activeWorkspaceId) return;
						const id = addTerminalTab(activeWorkspaceId, activeWorkspaceCwd);
						setTerminalActiveTab(id);
						setActivePane({ kind: "terminal" });
					}}
					className="flex h-[30px] w-[30px] items-center justify-center rounded-[6px] border-none bg-transparent text-[var(--text-quaternary)] transition-all duration-[120ms] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-tertiary)] disabled:cursor-default disabled:opacity-30"
					style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
				>
					<svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none">
						<path
							d="M8 3v10M3 8h10"
							stroke="currentColor"
							strokeWidth="1.5"
							strokeLinecap="round"
						/>
					</svg>
				</button>
			</div>
		</div>
	);
}
