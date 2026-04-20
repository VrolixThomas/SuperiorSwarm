import { useCallback, useRef } from "react";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";
import { Popover } from "./ui/Popover";

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
	const attachTerminal = trpc.workspaces.attachTerminal.useMutation();
	const attachTerminalRef = useRef(attachTerminal.mutate);
	attachTerminalRef.current = attachTerminal.mutate;

	const navigateToWorkspace = useCallback(
		(ws: LinkedWorkspace) => {
			const store = useTabStore.getState();
			store.setActiveWorkspace(ws.workspaceId, ws.worktreePath);

			const existing = store.getTabsByWorkspace(ws.workspaceId);
			const hasTerminal = existing.some((t) => t.kind === "terminal");
			if (!hasTerminal) {
				const title = ws.workspaceName ?? ws.workspaceId;
				const tabId = store.addTerminalTab(ws.workspaceId, ws.worktreePath, title);
				attachTerminalRef.current({ workspaceId: ws.workspaceId, terminalId: tabId });
			}

			onClose();
		},
		[onClose]
	);

	return (
		<Popover
			position={position}
			onClose={onClose}
			role="menu"
			className="min-w-[180px] max-w-[260px] bg-[var(--bg-elevated)] py-1"
		>
			{/* Workspace list */}
			{workspaces.map((ws) => (
				<button
					key={ws.workspaceId}
					type="button"
					role="menuitem"
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
			{workspaces.length > 0 && <div className="my-1 border-t border-[var(--border)]" />}

			{/* Create branch action */}
			<button
				type="button"
				role="menuitem"
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
				<span>Add workspace</span>
			</button>
		</Popover>
	);
}
