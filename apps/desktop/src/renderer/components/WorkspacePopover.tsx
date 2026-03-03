import { useCallback, useEffect, useRef, useState } from "react";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";

export interface LinkedWorkspace {
	workspaceId: string;
	workspaceName: string | null;
	worktreePath: string;
}

interface Props {
	position: { x: number; y: number };
	workspaces: LinkedWorkspace[];
	onClose: () => void;
	onCreateBranch: () => void;
}

export function WorkspacePopover({ position, workspaces, onClose, onCreateBranch }: Props) {
	const menuRef = useRef<HTMLDivElement>(null);
	const [adjusted, setAdjusted] = useState(position);
	const attachTerminal = trpc.workspaces.attachTerminal.useMutation();

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

	useEffect(() => {
		function handleClickOutside(e: MouseEvent) {
			if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
				onClose();
			}
		}
		document.addEventListener("mousedown", handleClickOutside);
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, [onClose]);

	useEffect(() => {
		function handleKeyDown(e: KeyboardEvent) {
			if (e.key === "Escape") {
				onClose();
			}
		}
		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [onClose]);

	const navigateToWorkspace = useCallback(
		(ws: LinkedWorkspace) => {
			const store = useTabStore.getState();
			store.setActiveWorkspace(ws.workspaceId, ws.worktreePath);

			const existing = store.getTabsByWorkspace(ws.workspaceId);
			const hasTerminal = existing.some((t) => t.kind === "terminal");
			if (!hasTerminal) {
				const title = ws.workspaceName ?? ws.workspaceId;
				const tabId = store.addTerminalTab(ws.workspaceId, ws.worktreePath, title);
				attachTerminal.mutate({ workspaceId: ws.workspaceId, terminalId: tabId });
			}

			onClose();
		},
		[onClose, attachTerminal]
	);

	return (
		<div
			ref={menuRef}
			className="fixed z-50 min-w-[180px] max-w-[260px] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)] py-1 shadow-[var(--shadow-md)]"
			style={{ left: adjusted.x, top: adjusted.y }}
		>
			{/* Workspace list */}
			{workspaces.map((ws) => (
				<button
					key={ws.workspaceId}
					type="button"
					className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-[var(--text-secondary)] transition-all duration-[120ms] hover:bg-[var(--bg-overlay)]"
					onClick={() => navigateToWorkspace(ws)}
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

			{/* Divider */}
			<div className="my-1 border-t border-[var(--border)]" />

			{/* Create branch action */}
			<button
				type="button"
				className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-[var(--text-tertiary)] transition-all duration-[120ms] hover:bg-[var(--bg-overlay)] hover:text-[var(--text-secondary)]"
				onClick={() => {
					onClose();
					onCreateBranch();
				}}
			>
				<svg
					aria-hidden="true"
					width="12"
					height="12"
					viewBox="0 0 16 16"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.5"
					strokeLinecap="round"
				>
					<path d="M8 3v10M3 8h10" />
				</svg>
				<span>Create branch</span>
			</button>
		</div>
	);
}
