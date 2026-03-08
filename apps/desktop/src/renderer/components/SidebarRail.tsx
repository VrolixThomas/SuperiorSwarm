import { useCallback, useRef, useState } from "react";
import type { Project } from "../../main/db/schema";
import { useProjectStore } from "../stores/projects";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";
import { ProjectItem } from "./ProjectItem";
import { PullRequestsTab } from "./PullRequestsTab";
import { RailFlyout } from "./RailFlyout";
import { TicketsTab } from "./TicketsTab";

/** Deterministic HSL color from a branch name string. */
function branchColor(name: string): string {
	let hash = 0;
	for (let i = 0; i < name.length; i++) {
		hash = name.charCodeAt(i) + ((hash << 5) - hash);
	}
	const hue = ((hash % 360) + 360) % 360;
	return `hsl(${hue} 55% 60%)`;
}

interface SidebarRailProps {
	onExpand: (section?: "tickets" | "prs") => void;
}

type FlyoutTarget = { kind: "project"; project: Project } | { kind: "tickets" } | { kind: "prs" };

const MAX_DOTS = 5;

interface RailProjectItemProps {
	project: Project;
	flyout: FlyoutTarget | null;
	openFlyout: (target: FlyoutTarget, el: HTMLElement) => void;
	scheduleDismiss: () => void;
	onExpand: () => void;
}

function RailProjectItem({
	project,
	flyout,
	openFlyout,
	scheduleDismiss,
	onExpand,
}: RailProjectItemProps) {
	const { data: workspacesList } = trpc.workspaces.listByProject.useQuery(
		{ projectId: project.id },
		{ enabled: project.status === "ready" }
	);

	const activeWorkspaceId = useTabStore((s) => s.activeWorkspaceId);
	const attachTerminal = trpc.workspaces.attachTerminal.useMutation();
	const attachTerminalRef = useRef(attachTerminal.mutate);
	attachTerminalRef.current = attachTerminal.mutate;

	const handleDotClick = useCallback(
		(ws: { id: string; type: string; name: string; worktreePath: string | null }) => {
			const cwd = ws.type === "worktree" && ws.worktreePath ? ws.worktreePath : project.repoPath;

			const store = useTabStore.getState();
			store.setActiveWorkspace(ws.id, cwd);

			const existing = store.getTabsByWorkspace(ws.id);
			const hasTerminal = existing.some((t) => t.kind === "terminal");
			if (!hasTerminal) {
				const title = `${project.name}: ${ws.name}`;
				const tabId = store.addTerminalTab(ws.id, cwd, title);
				attachTerminalRef.current({ workspaceId: ws.id, terminalId: tabId });
			}
		},
		[project.repoPath, project.name]
	);

	const isFlyoutActive = flyout?.kind === "project" && flyout.project.id === project.id;

	const visibleDots = workspacesList?.slice(0, MAX_DOTS);

	return (
		<div className="flex flex-col items-center">
			{/* Project initials button */}
			<button
				type="button"
				title={project.name}
				onMouseEnter={(e) => openFlyout({ kind: "project", project }, e.currentTarget)}
				onMouseLeave={scheduleDismiss}
				onClick={onExpand}
				className={[
					"flex size-8 shrink-0 items-center justify-center rounded-[6px] text-[11px] font-medium transition-colors duration-[120ms] hover:bg-[var(--bg-elevated)]",
					isFlyoutActive
						? "bg-[var(--bg-elevated)] text-[var(--text)]"
						: "text-[var(--text-secondary)]",
				].join(" ")}
				style={{
					borderLeft: `2px solid ${project.color ?? "transparent"}`,
				}}
			>
				{project.name.slice(0, 2).toUpperCase()}
			</button>

			{/* Worktree dots */}
			{visibleDots && visibleDots.length > 0 && (
				<div className="flex flex-col items-center gap-1 pt-1 pb-0.5">
					{visibleDots.map((ws) => (
						<button
							key={ws.id}
							type="button"
							title={ws.name}
							onClick={() => handleDotClick(ws)}
							className="flex items-center justify-center p-[6px]"
						>
							<div
								className="size-2 rounded-full transition-shadow duration-[120ms]"
								style={{
									backgroundColor: branchColor(ws.name),
									boxShadow: activeWorkspaceId === ws.id ? "0 0 0 2px var(--accent)" : "none",
								}}
							/>
						</button>
					))}
				</div>
			)}
		</div>
	);
}

export function SidebarRail({ onExpand }: SidebarRailProps) {
	const { openAddModal, openSettings } = useProjectStore();
	const { data: projectsList } = trpc.projects.list.useQuery();

	const [flyout, setFlyout] = useState<FlyoutTarget | null>(null);
	const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
	const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const railRef = useRef<HTMLDivElement>(null);

	const cancelDismiss = useCallback(() => {
		if (dismissTimer.current) {
			clearTimeout(dismissTimer.current);
			dismissTimer.current = null;
		}
	}, []);

	const scheduleDismiss = useCallback(() => {
		cancelDismiss();
		dismissTimer.current = setTimeout(() => {
			setFlyout(null);
			setAnchorRect(null);
		}, 150);
	}, [cancelDismiss]);

	const openFlyout = useCallback(
		(target: FlyoutTarget, el: HTMLElement) => {
			cancelDismiss();
			setFlyout(target);
			setAnchorRect(el.getBoundingClientRect());
		},
		[cancelDismiss]
	);

	const railWidth = railRef.current?.getBoundingClientRect().width ?? 56;

	return (
		<div ref={railRef} className="flex h-full w-full flex-col items-center bg-[var(--bg-surface)]">
			{/* Traffic light clearance */}
			<div
				className="w-full shrink-0"
				style={{ height: 52, WebkitAppRegion: "drag" } as React.CSSProperties}
			/>

			{/* Monogram */}
			<div className="pb-4">
				<span className="text-[11px] font-semibold text-[var(--text-quaternary)]">BF</span>
			</div>

			{/* Add Repository */}
			<button
				type="button"
				onClick={openAddModal}
				title="Add Repository"
				className="mb-3 flex size-8 items-center justify-center rounded-[6px] text-[var(--text-tertiary)] transition-colors duration-[120ms] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)]"
			>
				<svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none">
					<path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
				</svg>
			</button>

			{/* Project initials + worktree dots */}
			<div className="flex flex-1 flex-col items-center gap-1.5 overflow-y-auto py-1">
				{projectsList?.map((project) => (
					<RailProjectItem
						key={project.id}
						project={project}
						flyout={flyout}
						openFlyout={openFlyout}
						scheduleDismiss={scheduleDismiss}
						onExpand={() => onExpand()}
					/>
				))}
			</div>

			{/* Section icons */}
			<div className="flex flex-col items-center gap-1 border-t border-[var(--border-subtle)] py-2">
				{/* Tickets icon */}
				<button
					type="button"
					title="Tickets"
					onMouseEnter={(e) => openFlyout({ kind: "tickets" }, e.currentTarget)}
					onMouseLeave={scheduleDismiss}
					onClick={() => onExpand("tickets")}
					className={[
						"flex size-8 items-center justify-center rounded-[6px] transition-colors duration-[120ms] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)]",
						flyout?.kind === "tickets"
							? "bg-[var(--bg-elevated)] text-[var(--text-secondary)]"
							: "text-[var(--text-tertiary)]",
					].join(" ")}
				>
					<svg
						aria-hidden="true"
						width="15"
						height="15"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.5"
						strokeLinecap="round"
						strokeLinejoin="round"
					>
						<path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
						<rect x="9" y="3" width="6" height="4" rx="1" />
					</svg>
				</button>

				{/* PRs icon */}
				<button
					type="button"
					title="Pull Requests"
					onMouseEnter={(e) => openFlyout({ kind: "prs" }, e.currentTarget)}
					onMouseLeave={scheduleDismiss}
					onClick={() => onExpand("prs")}
					className={[
						"flex size-8 items-center justify-center rounded-[6px] transition-colors duration-[120ms] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)]",
						flyout?.kind === "prs"
							? "bg-[var(--bg-elevated)] text-[var(--text-secondary)]"
							: "text-[var(--text-tertiary)]",
					].join(" ")}
				>
					<svg
						aria-hidden="true"
						width="15"
						height="15"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.5"
						strokeLinecap="round"
						strokeLinejoin="round"
					>
						<circle cx="18" cy="18" r="3" />
						<circle cx="6" cy="6" r="3" />
						<path d="M6 9v12M18 9v0" />
						<path d="M13 6h3a2 2 0 0 1 2 2v1" />
					</svg>
				</button>
			</div>

			{/* Settings */}
			<div className="border-t border-[var(--border-subtle)] p-2">
				<button
					type="button"
					title="Settings"
					onClick={openSettings}
					className="flex size-8 items-center justify-center rounded-[6px] text-[var(--text-tertiary)] transition-colors duration-[120ms] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)]"
				>
					<svg
						aria-hidden="true"
						width="15"
						height="15"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.5"
						strokeLinecap="round"
						strokeLinejoin="round"
					>
						<circle cx="12" cy="12" r="3" />
						<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
					</svg>
				</button>
			</div>

			{/* Flyout portal */}
			{flyout && anchorRect && (
				<RailFlyout
					anchorRect={anchorRect}
					railWidth={railWidth}
					onMouseEnter={cancelDismiss}
					onMouseLeave={scheduleDismiss}
				>
					{flyout.kind === "project" && (
						<div className="p-2">
							<ProjectItem project={flyout.project} isExpanded onToggle={() => {}} />
						</div>
					)}
					{flyout.kind === "tickets" && <TicketsTab />}
					{flyout.kind === "prs" && <PullRequestsTab />}
				</RailFlyout>
			)}
		</div>
	);
}
