import { useEffect, useRef, useState } from "react";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";
import { OrchestratorIcon } from "./orchestrator/OrchestratorIcon";

interface Props {
	orchestrator: { id: string; name: string; colorIndex: number | null; workDir: string };
	counts: { total: number; working: number; blocked: number };
	onRename?: () => void;
	onDelete?: () => void;
}

export function CrossRepoOrchestratorRow({ orchestrator, counts, onRename, onDelete }: Props) {
	const openXroWorkspace = useTabStore((s) => s.openXroWorkspace);
	const activeWorkspaceId = useTabStore((s) => s.activeWorkspaceId);
	const colorIndex = ((orchestrator.colorIndex ?? 0) + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

	const utils = trpc.useUtils();
	// Fetch-on-demand: the launch command is only needed at click time.
	const getLaunch = trpc.crossRepoOrchestrators.getCoordinatorLaunch.useQuery(
		{ id: orchestrator.id },
		{ enabled: false }
	);
	const markStarted = trpc.crossRepoOrchestrators.markAgentStarted.useMutation();

	const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

	const swatchVar = `var(--orch-${colorIndex})`;
	const isActive = activeWorkspaceId === orchestrator.id;

	const working = counts.working;
	const blocked = counts.blocked;
	const memberCount = counts.total;

	async function open() {
		const workDir = orchestrator.workDir;
		const { terminalTabId, started } = openXroWorkspace(
			orchestrator.id,
			orchestrator.name,
			workDir
		);
		if (!started) return;
		// Auto-start the coordinator: run the launch command in the fresh terminal,
		// mirroring App.tsx agentDispatch.onOpen (wait for the pty to mount, then write).
		try {
			const res = await getLaunch.refetch();
			const cmd = res.data?.command;
			if (cmd) {
				setTimeout(() => {
					window.electron.terminal.write(terminalTabId, `${cmd}\n`);
				}, 300);
				markStarted.mutate(
					{ id: orchestrator.id },
					{ onSuccess: () => utils.crossRepoOrchestrators.list.invalidate() }
				);
			}
		} catch (err) {
			console.warn("[xro] coordinator start failed:", (err as Error).message);
		}
	}

	function openMeatball(e: React.MouseEvent<HTMLButtonElement>) {
		e.stopPropagation();
		const rect = e.currentTarget.getBoundingClientRect();
		setMenu({ x: rect.right, y: rect.bottom });
	}

	return (
		// biome-ignore lint/a11y/useSemanticElements: cannot use <button> — row contains a nested menu button
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
			className={[
				"group relative flex w-full cursor-pointer items-center gap-[9px] rounded-[8px] border py-[9px] pl-[10px] pr-[8px] text-left transition-colors duration-[120ms]",
				isActive
					? "border-[rgba(154,176,138,0.28)]"
					: "border-transparent hover:bg-[var(--bg-elevated)]",
			].join(" ")}
			style={isActive ? { background: `var(--orch-${colorIndex}-bg)` } : undefined}
		>
			{isActive && (
				<span
					className="absolute left-[-2px] top-[7px] bottom-[7px] w-[2.5px] rounded-[2px]"
					style={{ background: swatchVar }}
				/>
			)}
			<OrchestratorIcon size={13} color={swatchVar} />

			<span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[var(--text)]">
				{orchestrator.name}
			</span>

			<span className="flex shrink-0 items-center gap-[8px] text-[11px] text-[var(--text-tertiary)]">
				{working === 0 && blocked === 0 ? (
					<span>{memberCount === 0 ? "" : "idle"}</span>
				) : (
					<>
						{working > 0 && (
							<span className="inline-flex items-center gap-[5px]">
								<span className="h-[6px] w-[6px] rounded-full bg-[var(--st-working)]" />
								{working}
							</span>
						)}
						{blocked > 0 && (
							<span className="inline-flex items-center gap-[5px]">
								<span className="h-[6px] w-[6px] rounded-full bg-[var(--st-blocked)]" />
								{blocked}
							</span>
						)}
					</>
				)}
			</span>

			<button
				type="button"
				aria-label="Cross-repo orchestrator options"
				aria-haspopup="menu"
				aria-expanded={menu !== null}
				onClick={openMeatball}
				className="grid h-[24px] w-[24px] shrink-0 place-items-center rounded-[6px] border-none bg-transparent text-[var(--text-quaternary)] opacity-0 transition-opacity hover:bg-[var(--bg-overlay)] hover:text-[var(--text-secondary)] group-hover:opacity-100"
			>
				<svg width="13" height="13" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
					<circle cx="6" cy="2" r="1.1" />
					<circle cx="6" cy="6" r="1.1" />
					<circle cx="6" cy="10" r="1.1" />
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
