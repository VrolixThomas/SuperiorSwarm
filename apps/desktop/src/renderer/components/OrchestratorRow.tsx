import { useCallback, useEffect, useRef, useState } from "react";
import { useTabStore } from "../stores/tab-store";

interface OrchestratorRowProps {
	workspace: { id: string; name: string };
	colorIndex: 1 | 2 | 3;
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

	const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

	const handleContextMenu = useCallback(
		(e: React.MouseEvent) => {
			if (!onUnsetOrchestrator) return;
			e.preventDefault();
			setContextMenu({ x: e.clientX, y: e.clientY });
		},
		[onUnsetOrchestrator]
	);

	const handleUnset = useCallback(() => {
		onUnsetOrchestrator?.();
		setContextMenu(null);
	}, [onUnsetOrchestrator]);

	const swatchVar = `var(--orch-${colorIndex})`;
	const pillBg = `var(--orch-${colorIndex}-bg)`;
	const pillFg = swatchVar;

	const rowClass = [
		"relative flex w-full items-center gap-2 border-none pl-[22px] pr-3 py-[7px] cursor-pointer",
		"transition-all duration-[120ms] text-left rounded-[6px]",
		isAccented
			? "bg-[var(--accent-subtle)] hover:bg-[var(--accent-subtle)]"
			: "bg-transparent hover:bg-[var(--bg-elevated)]",
	].join(" ");

	return (
		<div className="relative flex items-center" onContextMenu={handleContextMenu}>
			{isAccented && (
				<span
					aria-hidden="true"
					className="absolute left-0 top-1 bottom-1 w-[3px] rounded-r-[2px] bg-[var(--accent)] z-10"
				/>
			)}
			<button
				type="button"
				aria-label={expanded ? "Collapse group" : "Expand group"}
				onClick={(e) => {
					e.stopPropagation();
					onToggle();
				}}
				className="absolute left-[22px] z-10 text-[10px] text-[var(--text-quaternary)] w-[10px] border-none bg-transparent p-0 cursor-pointer"
			>
				{expanded ? "▾" : "▸"}
			</button>
			<button type="button" onClick={onActivate} className={rowClass}>
				<span className="w-[10px] -mr-[2px]" aria-hidden="true" />
				<span
					aria-hidden="true"
					className="h-[8px] w-[8px] rounded-[2px] shrink-0"
					style={{ background: swatchVar }}
				/>
				<span className="flex-1 min-w-0 truncate text-[13px] font-medium text-[var(--text-secondary)]">
					{workspace.name}
					{!expanded && activeChildName && (
						<span className="text-[var(--text-tertiary)]"> · {activeChildName}</span>
					)}
				</span>
				<span
					className="text-[10px] font-medium px-[7px] py-[1px] rounded-[9px] min-w-[16px] text-center"
					style={{ background: pillBg, color: pillFg }}
				>
					{childCount}
				</span>
			</button>
			{contextMenu && onUnsetOrchestrator && (
				<OrchestratorContextMenu
					position={contextMenu}
					onClose={() => setContextMenu(null)}
					onUnsetOrchestrator={handleUnset}
				/>
			)}
		</div>
	);
}
