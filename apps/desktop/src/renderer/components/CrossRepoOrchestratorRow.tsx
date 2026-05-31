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

	const start = trpc.crossRepoOrchestrators.startAgent.useMutation({
		onError: (err) => console.warn("[xro] start failed:", err.message),
	});

	const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

	const swatchVar = `var(--orch-${colorIndex})`;

	const memberRows = members.data ?? [];
	const memberCount = memberRows.length;
	const repoCount = linked.data?.length ?? 0;
	const working = memberRows.filter((m) => m.currentPhase === "working").length;
	const blocked = memberRows.filter((m) => m.currentPhase === "blocked").length;

	function open() {
		openXroCanvas(orchestrator.id, orchestrator.name);
	}

	function openMeatball(e: React.MouseEvent<HTMLButtonElement>) {
		e.stopPropagation();
		const rect = e.currentTarget.getBoundingClientRect();
		setMenu({ x: rect.right, y: rect.bottom });
	}

	return (
		// biome-ignore lint/a11y/useSemanticElements: cannot use <button> — row contains nested action buttons
		<div
			role="button"
			tabIndex={0}
			onClick={open}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					open();
				}
			}}
			onContextMenu={(e) => {
				e.preventDefault();
				setMenu({ x: e.clientX, y: e.clientY });
			}}
			className="group relative flex w-full cursor-pointer items-center gap-[9px] rounded-[8px] border border-transparent bg-transparent py-[9px] pl-[10px] pr-[8px] text-left transition-colors duration-[120ms] hover:bg-[var(--bg-elevated)]"
		>
			<svg
				role="img"
				aria-label="Cross-repo orchestrator"
				width="16"
				height="16"
				viewBox="0 0 14 14"
				fill="none"
				className="shrink-0"
			>
				<title>Cross-repo orchestrator</title>
				{/* Two linked hubs (the repos) joined by a coordinator dot in the middle. */}
				<circle cx="3" cy="7" r="2" stroke={swatchVar} strokeWidth="1.2" />
				<circle cx="11" cy="7" r="2" stroke={swatchVar} strokeWidth="1.2" />
				<circle cx="7" cy="7" r="1.1" fill={swatchVar} />
				<path d="M5 7h.6M8.4 7H9" stroke={swatchVar} strokeWidth="1.1" />
			</svg>

			<div className="min-w-0 flex-1">
				<div className="truncate text-[13px] font-semibold text-[var(--text)]">
					{orchestrator.name}
				</div>
				<div className="mt-[2px] flex items-center gap-[8px] text-[11px] text-[var(--text-tertiary)]">
					{working === 0 && blocked === 0 ? (
						<span className="inline-flex items-center gap-[5px]">
							<span className="h-[6px] w-[6px] rounded-full bg-[var(--st-idle)]" />
							{memberCount === 0
								? `${repoCount} ${repoCount === 1 ? "repo" : "repos"}`
								: `idle · ${memberCount} ${memberCount === 1 ? "agent" : "agents"}`}
						</span>
					) : (
						<>
							{working > 0 && (
								<span className="inline-flex items-center gap-[5px]">
									<span className="h-[6px] w-[6px] rounded-full bg-[var(--st-working)]" />
									{working} working
								</span>
							)}
							{blocked > 0 && (
								<span className="inline-flex items-center gap-[5px]">
									<span className="h-[6px] w-[6px] rounded-full bg-[var(--st-blocked)]" />
									{blocked} blocked
								</span>
							)}
						</>
					)}
				</div>
			</div>

			{/* Resting: count pill. Hover: action cluster. */}
			<span
				className="shrink-0 rounded-[9px] px-[7px] py-[1.5px] text-[10.5px] font-semibold leading-none tabular-nums group-hover:hidden"
				style={{ background: `var(--orch-${colorIndex}-bg)`, color: swatchVar }}
				title={`${repoCount} ${repoCount === 1 ? "repo" : "repos"} · ${memberCount} ${
					memberCount === 1 ? "agent" : "agents"
				}`}
			>
				{repoCount}·{memberCount}
			</span>

			<div className="hidden shrink-0 items-center gap-[4px] group-hover:flex">
				<button
					type="button"
					onClick={(e) => {
						e.stopPropagation();
						start.mutate({ id: orchestrator.id });
					}}
					disabled={start.isPending}
					title="Start agent"
					aria-label="Start cross-repo orchestrator agent"
					className="inline-flex h-[24px] items-center gap-[5px] rounded-[7px] border border-[rgba(93,201,131,0.28)] bg-[rgba(93,201,131,0.13)] pl-[8px] pr-[9px] text-[11px] font-semibold text-[var(--st-done)] hover:bg-[rgba(93,201,131,0.22)] disabled:opacity-40"
				>
					<svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" aria-hidden="true">
						<path d="M1.5 1 L7 4 L1.5 7 Z" />
					</svg>
					Start
				</button>

				<button
					type="button"
					aria-label="Cross-repo orchestrator options"
					aria-haspopup="menu"
					aria-expanded={menu !== null}
					onClick={openMeatball}
					className="grid h-[24px] w-[24px] place-items-center rounded-[6px] border-none bg-transparent text-[var(--text-quaternary)] hover:bg-[var(--bg-overlay)] hover:text-[var(--text-secondary)]"
				>
					<svg width="13" height="13" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
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
					className="grid h-[24px] w-[24px] place-items-center rounded-[6px] border-none bg-transparent text-[var(--text-quaternary)] hover:bg-[var(--bg-overlay)] hover:text-[var(--text-secondary)]"
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
			</div>

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
					className="block w-full px-3 py-1.5 text-left text-[13px] text-[var(--text)] hover:bg-[var(--bg-overlay)]"
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
					className="block w-full px-3 py-1.5 text-left text-[13px] text-[var(--text)] hover:bg-[var(--bg-overlay)]"
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
