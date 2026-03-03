import { useEffect, useRef, useState } from "react";
import { trpc } from "../trpc/client";
import type { LinkedWorkspace } from "./WorkspacePopover";

interface IssueContextMenuProps {
	position: { x: number; y: number };
	issue: {
		id: string;
		identifier: string;
		url: string;
		stateId: string;
		teamId: string;
	};
	workspaces: LinkedWorkspace[] | undefined;
	onClose: () => void;
	onStateUpdate: (issueId: string, stateId: string) => void;
	onCreateBranch: () => void;
	onNavigateToWorkspace: (ws: LinkedWorkspace) => void;
}

export function IssueContextMenu({
	position,
	issue,
	workspaces,
	onClose,
	onStateUpdate,
	onCreateBranch,
	onNavigateToWorkspace,
}: IssueContextMenuProps) {
	const menuRef = useRef<HTMLDivElement>(null);
	const [adjusted, setAdjusted] = useState(position);

	const { data: states } = trpc.linear.getTeamStates.useQuery(
		{ teamId: issue.teamId },
		{ staleTime: 5 * 60_000 }
	);

	// Viewport clamping
	useEffect(() => {
		if (!menuRef.current) return;
		const rect = menuRef.current.getBoundingClientRect();
		let { x, y } = position;

		if (x + rect.width > window.innerWidth) {
			x = window.innerWidth - rect.width - 8;
		}
		if (y + rect.height > window.innerHeight) {
			y = window.innerHeight - rect.height - 8;
		}

		if (x !== position.x || y !== position.y) {
			setAdjusted({ x, y });
		}
	}, [position]);

	// Click outside → close
	useEffect(() => {
		function handleClickOutside(e: MouseEvent) {
			if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
				onClose();
			}
		}
		document.addEventListener("mousedown", handleClickOutside);
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, [onClose]);

	// Escape → close
	useEffect(() => {
		function handleKeyDown(e: KeyboardEvent) {
			if (e.key === "Escape") {
				onClose();
			}
		}
		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [onClose]);

	return (
		<div
			ref={menuRef}
			role="menu"
			className="fixed z-50 min-w-[180px] max-w-[260px] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)] py-1 shadow-[var(--shadow-md)]"
			style={{ left: adjusted.x, top: adjusted.y }}
		>
			{/* State picker */}
			<div className="px-3 py-1.5">
				<select
					className="w-full rounded bg-[var(--bg-overlay)] px-2 py-1 text-[13px] text-[var(--text-secondary)] outline-none"
					value={issue.stateId}
					onChange={(e) => {
						onStateUpdate(issue.id, e.target.value);
					}}
					onClick={(e) => e.stopPropagation()}
					onKeyDown={(e) => e.stopPropagation()}
				>
					{states?.map((s) => (
						<option key={s.id} value={s.id}>
							{s.name}
						</option>
					))}
				</select>
			</div>

			<div className="my-1 border-t border-[var(--border)]" />

			{/* Open in Linear */}
			<button
				type="button"
				role="menuitem"
				className="flex w-full items-center justify-between px-3 py-1.5 text-left text-[13px] text-[var(--text-secondary)] transition-all duration-[120ms] hover:bg-[var(--bg-overlay)]"
				onClick={() => {
					window.electron.shell.openExternal(issue.url);
					onClose();
				}}
			>
				<span>Open in Linear</span>
				<svg
					aria-hidden="true"
					width="12"
					height="12"
					viewBox="0 0 16 16"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.5"
					strokeLinecap="round"
					strokeLinejoin="round"
					className="shrink-0 text-[var(--text-quaternary)]"
				>
					<path d="M6 3H3a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-3" />
					<path d="M10 2h4v4" />
					<path d="M14 2L8 8" />
				</svg>
			</button>

			{/* Create branch */}
			<button
				type="button"
				role="menuitem"
				className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-[var(--text-secondary)] transition-all duration-[120ms] hover:bg-[var(--bg-overlay)]"
				onClick={() => {
					onClose();
					onCreateBranch();
				}}
			>
				<span>Create branch</span>
			</button>

			{/* Workspace entries (only if linked) */}
			{workspaces && workspaces.length > 0 && (
				<>
					<div className="my-1 border-t border-[var(--border)]" />
					{workspaces.map((ws) => (
						<button
							key={ws.workspaceId}
							type="button"
							role="menuitem"
							className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-[var(--text-secondary)] transition-all duration-[120ms] hover:bg-[var(--bg-overlay)]"
							onClick={() => {
								onNavigateToWorkspace(ws);
								onClose();
							}}
						>
							<svg
								aria-hidden="true"
								width="12"
								height="12"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
								className="shrink-0 text-[var(--text-quaternary)]"
							>
								<line x1="6" y1="3" x2="6" y2="15" />
								<circle cx="18" cy="6" r="3" />
								<circle cx="6" cy="18" r="3" />
								<path d="M18 9a9 9 0 0 1-9 9" />
							</svg>
							<span className="truncate">{ws.workspaceName ?? ws.workspaceId}</span>
						</button>
					))}
				</>
			)}
		</div>
	);
}
