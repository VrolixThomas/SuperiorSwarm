import { Fragment, useCallback, useRef, useState } from "react";
import type { Pane } from "../../../shared/pane-types";
import { usePaneStore } from "../../stores/pane-store";
import type { TabItem } from "../../stores/tab-store";
import { useTabStore } from "../../stores/tab-store";
import { trpc } from "../../trpc/client";
import { TAB_DRAG_MIME } from "./DropZoneOverlay";
import { PaneContextMenu } from "./PaneContextMenu";

function TabIcon({ kind }: { kind: TabItem["kind"] }) {
	if (kind === "terminal") {
		return (
			<span className="shrink-0 font-mono text-[10px] text-[var(--text-quaternary)]">&gt;_</span>
		);
	}
	if (kind === "diff-file") {
		return (
			<span className="shrink-0 h-[6px] w-[6px] rounded-full bg-[var(--term-yellow)] opacity-70" />
		);
	}
	return null;
}

function accentColor(kind: TabItem["kind"]): string {
	return kind === "diff-file" ? "bg-[var(--term-yellow)]" : "bg-[var(--accent)]";
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
			className={`group relative flex h-[28px] max-w-[180px] shrink-0 cursor-pointer select-none items-center gap-1.5 rounded-[6px] pl-2.5 pr-1.5 text-[12px] transition-all duration-[120ms] ${
				isActive
					? "bg-[var(--tab-active-bg)] text-[var(--text)] shadow-[0_1px_3px_rgba(0,0,0,0.4),inset_0_0.5px_0_rgba(255,255,255,0.04)]"
					: "bg-[var(--tab-inactive-bg)] text-[var(--text-tertiary)] hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--text-secondary)]"
			}`}
		>
			{isActive && (
				<span
					className={`absolute inset-x-2 bottom-0 h-[2px] rounded-full ${accentColor(tab.kind)}`}
				/>
			)}
			<TabIcon kind={tab.kind} />
			<span className="min-w-0 truncate">{tab.title}</span>
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
	const removeTabFromPane = usePaneStore((s) => s.removeTabFromPane);
	const setFocusedPane = usePaneStore((s) => s.setFocusedPane);
	const splitPane = usePaneStore((s) => s.splitPane);
	const closePane = usePaneStore((s) => s.closePane);
	const addTerminalTab = useTabStore((s) => s.addTerminalTab);
	const activeWorkspaceCwd = useTabStore((s) => s.activeWorkspaceCwd);
	// O(1) check: a split root means at least 2 panes exist
	const canClosePane = usePaneStore((s) => {
		const layout = s.layouts[workspaceId];
		return layout ? layout.type === "split" : false;
	});

	const detachMutation = trpc.workspaces.detachTerminal.useMutation();

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
			className="flex h-[36px] shrink-0 items-center border-b border-[var(--tab-border)] bg-[var(--bg-tab-bar)]"
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
								onSelect={() => setActiveTabInPane(workspaceId, pane.id, tab.id)}
								onClose={() => {
									if (tab.kind === "terminal") {
										// Kill the PTY before removing the tab
										window.electron.terminal.dispose(tab.id);
										if (tab.workspaceId) {
											detachMutation.mutate({
												workspaceId: tab.workspaceId,
											});
										}
									}
									removeTabFromPane(workspaceId, pane.id, tab.id);
								}}
								onContextMenu={(e) => handleTabContextMenu(e, tab)}
							/>
						</Fragment>
					);
				})}
			</div>

			{/* New terminal button */}
			<div className="shrink-0 pr-1">
				<button
					type="button"
					aria-label="New terminal tab"
					onClick={() => {
						// Focus this pane so addTerminalTab adds the tab here
						setFocusedPane(pane.id);
						addTerminalTab(workspaceId, activeWorkspaceCwd);
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
			</div>

			{contextMenu && (
				<PaneContextMenu
					x={contextMenu.x}
					y={contextMenu.y}
					onSplitRight={() => splitPane(workspaceId, pane.id, "horizontal", contextMenu.tab)}
					onSplitDown={() => splitPane(workspaceId, pane.id, "vertical", contextMenu.tab)}
					onClosePane={canClosePane ? () => closePane(workspaceId, pane.id) : undefined}
					onClose={() => setContextMenu(null)}
				/>
			)}
		</div>
	);
}
