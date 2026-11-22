import { Fragment, useCallback, useRef, useState } from "react";
import type { Pane } from "../../../shared/pane-types";
import { openBrowserTab } from "../../browser/lifecycle";
import {
	closePaneWithTerminalCleanup,
	closeTabWithTerminalCleanup,
	requestReviewAgentStop,
} from "../../lib/pane-lifecycle";
import { usePaneStore } from "../../stores/pane-store";
import type { TabItem } from "../../stores/tab-store";
import { useTabStore } from "../../stores/tab-store";
import { TAB_DRAG_MIME } from "./DropZoneOverlay";
import { PaneContextMenu } from "./PaneContextMenu";

function TabIcon({ kind }: { kind: TabItem["kind"] }) {
	if (kind === "browser") return <span aria-hidden="true">◎</span>;
	if (kind === "terminal" || kind === "review-agent") {
		return (
			<span className="shrink-0 font-mono text-[10px] text-[var(--text-quaternary)]">&gt;_</span>
		);
	}
	if (kind === "diff-file") {
		return (
			<span className="shrink-0 h-[6px] w-[6px] rounded-full bg-[var(--term-yellow)] opacity-70" />
		);
	}
	if (kind === "review" || kind === "pr-review") {
		return (
			<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
				<path d="M2 2h12v2H2V2zm0 5h12v2H2V7zm0 5h8v2H2v-2z" />
			</svg>
		);
	}
	return null;
}

function accentColor(kind: TabItem["kind"]): string {
	if (kind === "diff-file") return "bg-[var(--term-yellow)]";
	if (kind === "review") return "bg-[var(--accent)]";
	return "bg-[var(--accent)]";
}

function TabPill({
	tab,
	isActive,
	paneId,
	onSelect,
	onClose,
	onContextMenu,
}: {
	tab: TabItem;
	isActive: boolean;
	paneId: string;
	onSelect: () => void;
	onClose: () => void;
	onContextMenu: (e: React.MouseEvent) => void;
}) {
	const closeRef = useRef<HTMLButtonElement>(null);
	const showClose = useCallback(() => {
		if (!isActive && closeRef.current) closeRef.current.style.opacity = "1";
	}, [isActive]);
	const hideClose = useCallback(() => {
		if (!isActive && closeRef.current) closeRef.current.style.opacity = "0";
	}, [isActive]);

	const handleDragStart = useCallback(
		(e: React.DragEvent) => {
			e.dataTransfer.setData(
				TAB_DRAG_MIME,
				JSON.stringify({ tabId: tab.id, sourcePaneId: paneId })
			);
			e.dataTransfer.effectAllowed = "move";
		},
		[tab.id, paneId]
	);

	return (
		<div
			role="tab"
			tabIndex={0}
			aria-selected={isActive}
			draggable
			onDragStart={handleDragStart}
			onClick={onSelect}
			onContextMenu={onContextMenu}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					onSelect();
				}
			}}
			onMouseEnter={showClose}
			onMouseLeave={hideClose}
			className={`app-no-drag group relative flex h-[28px] max-w-[180px] shrink-0 cursor-pointer select-none items-center gap-1.5 rounded-[6px] pl-2.5 pr-1.5 text-[12px] transition-all duration-[120ms] ${
				isActive
					? "bg-[var(--tab-active-bg)] text-[var(--text)] shadow-[var(--shadow-sm)]"
					: "bg-[var(--tab-inactive-bg)] text-[var(--text-tertiary)] hover:bg-[var(--bg-overlay)] hover:text-[var(--text-secondary)]"
			}`}
		>
			{isActive && (
				<span
					className={`absolute inset-x-2 bottom-0 h-[2px] rounded-full ${accentColor(tab.kind)}`}
				/>
			)}
			<TabIcon kind={tab.kind} />
			<span className="min-w-0 truncate">
				{tab.title}
				{tab.kind === "review-agent" && (tab.state === "queued" || tab.state === "preparing")
					? " · preparing"
					: tab.kind === "review-agent" && tab.state === "running"
						? tab.phase === "answering"
							? " · answering"
							: " · mapping"
						: ""}
			</span>
			{tab.kind === "review-agent" &&
				["queued", "preparing", "running"].includes(tab.state ?? "") && (
					<span
						aria-label="Agent working"
						className="h-[11px] w-[11px] shrink-0 animate-spin rounded-full border border-[var(--accent)] border-t-transparent"
					/>
				)}
			{tab.kind === "review-agent" && (tab.state === "failed" || tab.state === "needs-input") && (
				<span
					aria-label={tab.state === "failed" ? "Agent failed" : "Agent needs input"}
					className={`h-[6px] w-[6px] shrink-0 rounded-full ${tab.state === "failed" ? "bg-[var(--term-red)]" : "bg-[var(--term-yellow)]"}`}
				/>
			)}
			{tab.kind !== "pr-review" && (
				<button
					type="button"
					ref={closeRef}
					aria-label="Close tab"
					onClick={(e) => {
						e.stopPropagation();
						onClose();
					}}
					className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[4px] border-none bg-transparent p-0 transition-all duration-[120ms] hover:bg-[var(--bg-overlay)] hover:text-[var(--text)] ${
						isActive
							? "text-[var(--text-tertiary)] opacity-100"
							: "text-[var(--text-quaternary)] opacity-0"
					}`}
				>
					<svg aria-hidden="true" width="8" height="8" viewBox="0 0 9 9" fill="none">
						<path
							d="M2 2l5 5M7 2l-5 5"
							stroke="currentColor"
							strokeWidth="1.4"
							strokeLinecap="round"
						/>
					</svg>
				</button>
			)}
		</div>
	);
}

export function PaneTabBar({
	pane,
	workspaceId,
	paneIndex,
}: {
	pane: Pane;
	workspaceId: string;
	paneIndex: number;
}) {
	const setActiveTabInPane = usePaneStore((s) => s.setActiveTabInPane);
	const setFocusedPane = usePaneStore((s) => s.setFocusedPane);
	const splitPane = usePaneStore((s) => s.splitPaneForCommand);
	const metadata = useTabStore((s) => s.workspaceMetadata[workspaceId]);
	const canCreateTerminal = metadata?.type !== "review" || Boolean(metadata.reviewWorktreePath);
	const addTerminalTab = useTabStore((s) => s.addTerminalTab);
	const activeWorkspaceCwd = useTabStore((s) => s.activeWorkspaceCwd);
	// O(1) check: a split root means at least 2 panes exist
	const canClosePane = usePaneStore((s) => {
		const layout = s.layouts[workspaceId];
		return layout ? layout.type === "split" : false;
	});

	const [contextMenu, setContextMenu] = useState<{
		x: number;
		y: number;
		tab?: TabItem;
	} | null>(null);

	const handleTabContextMenu = useCallback((e: React.MouseEvent, tab: TabItem) => {
		e.preventDefault();
		e.stopPropagation();
		setContextMenu({ x: e.clientX, y: e.clientY, tab });
	}, []);

	const handleBarContextMenu = useCallback((e: React.MouseEvent) => {
		// Only trigger on empty area (the bar itself or the tablist padding)
		if ((e.target as HTMLElement).closest("[role=tab]")) return;
		e.preventDefault();
		e.stopPropagation();
		setContextMenu({ x: e.clientX, y: e.clientY });
	}, []);

	return (
		<div
			className="app-drag flex h-[36px] shrink-0 items-center border-b border-[var(--tab-border)] bg-[var(--bg-tab-bar)]"
			onContextMenu={handleBarContextMenu}
		>
			{/* Pane index indicator */}
			<div className="flex h-full w-[28px] shrink-0 items-center justify-center text-[11px] font-medium text-[var(--text-quaternary)]">
				{paneIndex}
			</div>

			<div
				role="tablist"
				className="scrollbar-hide flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto"
			>
				{pane.tabs.map((tab, i) => {
					const isActive = tab.id === pane.activeTabId;
					const prevIsActive = i > 0 && pane.tabs[i - 1]?.id === pane.activeTabId;

					return (
						<Fragment key={tab.id}>
							{i > 0 && !isActive && !prevIsActive && (
								<div className="mx-px h-[12px] w-px shrink-0 rounded-full bg-[var(--border)]" />
							)}
							{i > 0 && (isActive || prevIsActive) && <div className="w-0.5 shrink-0" />}
							<TabPill
								tab={tab}
								isActive={isActive}
								paneId={pane.id}
								onSelect={() => {
									setFocusedPane(pane.id);
									setActiveTabInPane(workspaceId, pane.id, tab.id);
								}}
								onClose={() => closeTabWithTerminalCleanup(workspaceId, pane.id, tab.id)}
								onContextMenu={(e) => handleTabContextMenu(e, tab)}
							/>
						</Fragment>
					);
				})}
			</div>

			{/* Workspace browser entry beside the new terminal button. */}
			<button
				type="button"
				aria-label="New browser tab"
				title="New browser tab"
				className="app-no-drag shrink-0 rounded px-2 text-[var(--text-tertiary)] hover:bg-[var(--bg-overlay)]"
				onClick={() => {
					setFocusedPane(pane.id);
					openBrowserTab(workspaceId);
				}}
			>
				◎
			</button>
			{/* New terminal button */}
			<div className="app-no-drag flex shrink-0 pr-1">
				<button
					type="button"
					aria-label="New terminal tab"
					disabled={!canCreateTerminal}
					title={
						canCreateTerminal
							? "New terminal tab"
							: "Start an agent to prepare an isolated review workspace"
					}
					onClick={() => {
						// Focus this pane so addTerminalTab adds the tab here
						setFocusedPane(pane.id);
						addTerminalTab(
							workspaceId,
							metadata?.reviewWorktreePath ?? activeWorkspaceCwd,
							undefined
						);
					}}
					className="flex h-[24px] w-[24px] items-center justify-center rounded-[5px] border-none bg-transparent text-[var(--text-quaternary)] transition-all duration-[120ms] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-tertiary)]"
				>
					<svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" fill="none">
						<path
							d="M8 3v10M3 8h10"
							stroke="currentColor"
							strokeWidth="1.5"
							strokeLinecap="round"
						/>
					</svg>
				</button>
				<button
					type="button"
					aria-label="Split pane right"
					title="Split right (⌘\\)"
					onClick={() => splitPane(workspaceId, pane.id, "horizontal")}
					className="flex h-[24px] w-[24px] items-center justify-center rounded-[5px] border-none bg-transparent text-[var(--text-quaternary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-tertiary)]"
				>
					<svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none">
						<rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="currentColor" />
						<path d="M8 3v10" stroke="currentColor" />
					</svg>
				</button>
			</div>

			{contextMenu && (
				<PaneContextMenu
					x={contextMenu.x}
					y={contextMenu.y}
					onSplitRight={() => splitPane(workspaceId, pane.id, "horizontal", contextMenu.tab)}
					onSplitDown={() => splitPane(workspaceId, pane.id, "vertical", contextMenu.tab)}
					onClosePane={
						canClosePane ? () => closePaneWithTerminalCleanup(workspaceId, pane.id) : undefined
					}
					onOpenBesideReview={
						contextMenu.tab?.kind === "review-agent"
							? () =>
									useTabStore.getState().revealReviewAgentTab(workspaceId, {
										jobId: (contextMenu.tab as Extract<TabItem, { kind: "review-agent" }>).jobId,
										beside: true,
									})
							: undefined
					}
					onStopAgent={
						contextMenu.tab?.kind === "review-agent" &&
						["queued", "preparing", "running", "needs-input"].includes(contextMenu.tab.state ?? "")
							? () =>
									requestReviewAgentStop({
										workspaceId,
										jobId: (contextMenu.tab as Extract<TabItem, { kind: "review-agent" }>).jobId,
									})
							: undefined
					}
					onClose={() => setContextMenu(null)}
				/>
			)}
		</div>
	);
}
