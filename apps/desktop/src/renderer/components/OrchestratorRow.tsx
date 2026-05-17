import { useEffect, useRef, useState } from "react";
import { useTabStore } from "../stores/tab-store";

interface OrchestratorRowProps {
	workspace: { id: string; name: string };
	colorIndex: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
	childCount: number;
	expanded: boolean;
	onToggle: () => void;
	onActivate: () => void;
	activeChildName?: string;
	onUnsetOrchestrator?: () => void;
}

function OrchestratorContextMenu({
	position,
	onClose,
	onUnsetOrchestrator,
}: {
	position: { x: number; y: number };
	onClose: () => void;
	onUnsetOrchestrator: () => void;
}) {
	const menuRef = useRef<HTMLDivElement>(null);
	const [adjusted, setAdjusted] = useState(position);

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

	return (
		<div
			ref={menuRef}
			className="fixed z-50 min-w-[160px] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)] py-1 shadow-[var(--shadow-md)]"
			style={{ left: adjusted.x, top: adjusted.y }}
		>
			<div
				role="menuitem"
				tabIndex={0}
				className="px-3 py-1.5 text-[13px] cursor-pointer hover:bg-[var(--bg-overlay)] transition-all duration-[120ms] text-[var(--text)]"
				onClick={onUnsetOrchestrator}
				onKeyDown={(e) => {
					if (e.key === "Enter") onUnsetOrchestrator();
				}}
			>
				Unset orchestrator
			</div>
		</div>
	);
}

export function OrchestratorRow({
	workspace,
	colorIndex,
	childCount,
	expanded,
	onToggle,
	onActivate,
	activeChildName,
	onUnsetOrchestrator,
}: OrchestratorRowProps) {
	const isActive = useTabStore((s) => s.activeWorkspaceId === workspace.id);
	const isActiveByChild = !expanded && activeChildName !== undefined;
	const isAccented = isActive || isActiveByChild;

	const swatchVar = `var(--orch-${colorIndex})`;
	const pillBg = `var(--orch-${colorIndex}-bg)`;
	const pillFg = swatchVar;

	const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

	return (
		<div
			className={[
				"relative flex items-center w-full rounded-[6px] transition-colors duration-[120ms]",
				isAccented ? "bg-[var(--accent-subtle)]" : "bg-transparent hover:bg-[var(--bg-elevated)]",
			].join(" ")}
			onContextMenu={
				onUnsetOrchestrator
					? (e) => {
							e.preventDefault();
							setContextMenu({ x: e.clientX, y: e.clientY });
						}
					: undefined
			}
		>
			{isAccented && (
				<span
					aria-hidden="true"
					className="absolute left-0 top-1 bottom-1 w-[3px] rounded-r-[2px] bg-[var(--accent)] z-10 pointer-events-none"
				/>
			)}

			<button
				type="button"
				onClick={onActivate}
				className="flex min-w-0 flex-1 items-center gap-2 border-none pl-[22px] pr-2 py-[7px] bg-transparent cursor-pointer text-left rounded-[6px]"
			>
				<svg
					role="img"
					aria-label="Orchestrator"
					width="12"
					height="12"
					viewBox="0 0 12 12"
					fill="none"
					className="shrink-0"
				>
					<title>Orchestrator</title>
					<circle cx="6" cy="2.5" r="1.4" stroke={swatchVar} strokeWidth="1.2" />
					<circle cx="2.5" cy="9.5" r="1.4" stroke={swatchVar} strokeWidth="1.2" />
					<circle cx="9.5" cy="9.5" r="1.4" stroke={swatchVar} strokeWidth="1.2" />
					<path
						d="M6 4 L3 8 M6 4 L9 8"
						stroke={swatchVar}
						strokeWidth="1.2"
						strokeLinecap="round"
					/>
				</svg>
				<span className="flex-1 min-w-0 truncate text-[13px] font-medium text-[var(--text-secondary)]">
					{workspace.name}
					{!expanded && activeChildName && (
						<span className="text-[var(--text-tertiary)]"> · {activeChildName}</span>
					)}
				</span>
				<span
					className="text-[10px] font-medium px-[7px] py-[1px] rounded-[9px] min-w-[16px] text-center"
					style={{ background: pillBg, color: pillFg }}
					title={`${childCount} ${childCount === 1 ? "worktree" : "worktrees"} attached`}
				>
					{childCount}
				</span>
			</button>

			<button
				type="button"
				onClick={(e) => {
					e.stopPropagation();
					onToggle();
				}}
				aria-label={expanded ? "Collapse group" : "Expand group"}
				className="flex shrink-0 items-center justify-center px-2 py-[7px] bg-transparent border-none cursor-pointer rounded-[6px] hover:bg-[var(--bg-overlay)]"
			>
				<svg
					aria-hidden="true"
					width="10"
					height="10"
					viewBox="0 0 10 10"
					fill="none"
					className={[
						"shrink-0 transition-transform duration-[120ms]",
						expanded ? "rotate-90" : "rotate-0",
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

			{contextMenu && onUnsetOrchestrator && (
				<OrchestratorContextMenu
					position={contextMenu}
					onClose={() => setContextMenu(null)}
					onUnsetOrchestrator={() => {
						onUnsetOrchestrator();
						setContextMenu(null);
					}}
				/>
			)}
		</div>
	);
}
