import { useEffect, useRef, useState } from "react";
import { useCrossRepoOrchestratorColor } from "../hooks/useCrossRepoOrchestratorColor";
import { useTabStore } from "../stores/tab-store";
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
	const openXroCanvas = useTabStore((s) => s.openXroCanvas);
	const colorIndex = useCrossRepoOrchestratorColor(orchestrator.id, allOrchestratorIds);
	const members = trpc.crossRepoOrchestrators.listMembers.useQuery({ id: orchestrator.id });
	const linked = trpc.crossRepoOrchestrators.listLinkedProjects.useQuery({ id: orchestrator.id });
	const memberCount = members.data?.length ?? 0;
	const repoCount = linked.data?.length ?? 0;

	const start = trpc.crossRepoOrchestrators.startAgent.useMutation({
		onError: (err) => console.warn("[xro] start failed:", err.message),
	});

	const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

	const swatchVar = `var(--orch-${colorIndex})`;
	const pillBg = `var(--orch-${colorIndex}-bg)`;
	const pillFg = swatchVar;

	function openMeatball(e: React.MouseEvent<HTMLButtonElement>) {
		e.stopPropagation();
		const rect = e.currentTarget.getBoundingClientRect();
		setMenu({ x: rect.right, y: rect.bottom });
	}

	return (
		<div
			className="group relative flex items-center w-full rounded-[6px] transition-colors duration-[120ms] bg-transparent hover:bg-[var(--bg-elevated)]"
			onContextMenu={(e) => {
				e.preventDefault();
				setMenu({ x: e.clientX, y: e.clientY });
			}}
		>
			<button
				type="button"
				onClick={() => openXroCanvas(orchestrator.id, orchestrator.name)}
				className="flex min-w-0 flex-1 items-center gap-2 border-none pl-[10px] pr-2 py-[7px] bg-transparent cursor-pointer text-left rounded-[6px]"
			>
				<svg
					role="img"
					aria-label="Cross-repo orchestrator"
					width="13"
					height="13"
					viewBox="0 0 14 14"
					fill="none"
					className="shrink-0"
				>
					<title>Cross-repo orchestrator</title>
					{/* Two linked hubs (the repos) joined by a coordinator dot in the middle. */}
					<circle cx="3" cy="7" r="2" stroke={swatchVar} strokeWidth="1.2" />
					<circle cx="11" cy="7" r="2" stroke={swatchVar} strokeWidth="1.2" />
					<circle cx="7" cy="7" r="1" fill={swatchVar} />
				</svg>
				<span className="flex-1 min-w-0 truncate text-[13px] font-medium text-[var(--text-secondary)]">
					{orchestrator.name}
				</span>
				<span
					className="text-[10px] font-medium px-[7px] py-[1px] rounded-[9px] tabular-nums leading-none"
					style={{ background: pillBg, color: pillFg }}
					title={`${repoCount} ${repoCount === 1 ? "repo" : "repos"} · ${memberCount} ${
						memberCount === 1 ? "member" : "members"
					}`}
				>
					{repoCount}/{memberCount}
				</span>
			</button>

			<button
				type="button"
				onClick={(e) => {
					e.stopPropagation();
					start.mutate({ id: orchestrator.id });
				}}
				disabled={start.isPending}
				aria-label="Start cross-repo orchestrator agent"
				title="Start agent"
				className="flex shrink-0 items-center justify-center px-1 py-[7px] bg-transparent border-none cursor-pointer rounded-[6px] hover:bg-[var(--bg-overlay)] opacity-0 group-hover:opacity-100 focus:opacity-100 disabled:opacity-40 disabled:cursor-not-allowed"
			>
				<svg
					aria-hidden="true"
					width="11"
					height="11"
					viewBox="0 0 11 11"
					fill="currentColor"
					className="text-[var(--text-tertiary)]"
				>
					<path d="M3 1.5 L9 5.5 L3 9.5 Z" />
				</svg>
			</button>

			<button
				type="button"
				aria-label="Cross-repo orchestrator options"
				aria-haspopup="menu"
				aria-expanded={menu !== null}
				onClick={openMeatball}
				className="flex shrink-0 items-center justify-center px-1 py-[7px] bg-transparent border-none cursor-pointer rounded-[6px] hover:bg-[var(--bg-overlay)] opacity-0 group-hover:opacity-100 focus:opacity-100"
			>
				<svg
					width="12"
					height="12"
					viewBox="0 0 12 12"
					fill="currentColor"
					aria-hidden="true"
					className="text-[var(--text-quaternary)]"
				>
					<circle cx="6" cy="2" r="1.1" />
					<circle cx="6" cy="6" r="1.1" />
					<circle cx="6" cy="10" r="1.1" />
				</svg>
			</button>

			<button
				type="button"
				onClick={(e) => {
					e.stopPropagation();
					onToggle();
				}}
				aria-label={expanded ? "Collapse" : "Expand"}
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

			{menu && (
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

	if (!onRename && !onDelete) return null;

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
