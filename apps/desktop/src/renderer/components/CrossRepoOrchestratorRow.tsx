import { useEffect, useRef, useState } from "react";
import { useCrossRepoOrchestratorColor } from "../hooks/useCrossRepoOrchestratorColor";
import { trpc } from "../trpc/client";

interface Props {
	orchestrator: { id: string; name: string };
	allOrchestratorIds: string[];
	expanded: boolean;
	onToggle: () => void;
	onRename?: () => void;
	onDelete?: () => void;
}

export function CrossRepoOrchestratorRow({
	orchestrator,
	allOrchestratorIds,
	expanded,
	onToggle,
	onRename,
	onDelete,
}: Props) {
	const colorIndex = useCrossRepoOrchestratorColor(orchestrator.id, allOrchestratorIds);
	const members = trpc.crossRepoOrchestrators.listMembers.useQuery({ id: orchestrator.id });
	const linked = trpc.crossRepoOrchestrators.listLinkedProjects.useQuery({ id: orchestrator.id });
	const memberCount = members.data?.length ?? 0;
	const repoCount = linked.data?.length ?? 0;

	const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

	return (
		<div
			className="group flex items-center gap-2 px-2 py-1.5 hover:bg-[var(--bg-elevated)] rounded-[var(--radius-md)] cursor-default"
			onContextMenu={(e) => {
				e.preventDefault();
				setMenu({ x: e.clientX, y: e.clientY });
			}}
		>
			<button
				type="button"
				onClick={onToggle}
				className="text-[var(--text-quaternary)] text-[10px] w-3"
				aria-label={expanded ? "Collapse" : "Expand"}
			>
				{expanded ? "▾" : "▸"}
			</button>
			<span
				className={`block w-2 h-2 rounded-sm bg-[var(--orch-${colorIndex})]`}
				aria-hidden="true"
			/>
			<span className="text-[13px] text-[var(--text)] truncate">{orchestrator.name}</span>
			<span className="ml-auto text-[10px] text-[var(--text-tertiary)] tabular-nums">
				{repoCount} {repoCount === 1 ? "repo" : "repos"} · {memberCount}
			</span>
			{menu && (onRename || onDelete) && (
				<ContextMenu
					position={menu}
					onClose={() => setMenu(null)}
					onRename={onRename}
					onDelete={onDelete}
				/>
			)}
		</div>
	);
}

function ContextMenu({
	position,
	onClose,
	onRename,
	onDelete,
}: {
	position: { x: number; y: number };
	onClose: () => void;
	onRename?: () => void;
	onDelete?: () => void;
}) {
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		function onClick(e: MouseEvent) {
			if (ref.current && !ref.current.contains(e.target as Node)) onClose();
		}
		document.addEventListener("mousedown", onClick);
		return () => document.removeEventListener("mousedown", onClick);
	}, [onClose]);

	return (
		<div
			ref={ref}
			className="fixed z-50 min-w-[160px] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)] py-1 shadow-[var(--shadow-md)]"
			style={{ left: position.x, top: position.y }}
		>
			{onRename && (
				<button
					type="button"
					className="block w-full text-left px-3 py-1.5 text-[13px] hover:bg-[var(--bg-overlay)] text-[var(--text)]"
					onClick={() => {
						onRename();
						onClose();
					}}
				>
					Rename
				</button>
			)}
			{onDelete && (
				<button
					type="button"
					className="block w-full text-left px-3 py-1.5 text-[13px] hover:bg-[var(--bg-overlay)] text-[var(--text)]"
					onClick={() => {
						onDelete();
						onClose();
					}}
				>
					Delete
				</button>
			)}
		</div>
	);
}
