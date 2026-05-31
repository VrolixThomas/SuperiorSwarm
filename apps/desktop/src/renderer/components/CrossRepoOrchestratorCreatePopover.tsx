import { useEffect, useRef, useState } from "react";
import { trpc } from "../trpc/client";

type AgentKind = "claude" | "codex" | "gemini" | "opencode";

const AGENT_OPTIONS: AgentKind[] = ["claude", "codex", "gemini", "opencode"];

/**
 * Inline create panel anchored under the Orchestrators section header.
 * Replaces the full-screen modal so creating one never loses sidebar context.
 * The parent must position this (it renders `absolute`).
 */
export function CrossRepoOrchestratorCreatePopover({
	onClose,
	onCreated,
}: {
	onClose: () => void;
	onCreated?: (id: string) => void;
}) {
	const [name, setName] = useState("");
	const [agentKind, setAgentKind] = useState<AgentKind>("claude");
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [isPending, setIsPending] = useState(false);
	const [err, setErr] = useState<string | null>(null);

	const utils = trpc.useUtils();
	const projects = trpc.projects.list.useQuery();
	const createMut = trpc.crossRepoOrchestrators.create.useMutation();
	const linkMut = trpc.crossRepoOrchestrators.linkProject.useMutation();

	const wrap = useRef<HTMLDivElement>(null);
	const nameRef = useRef<HTMLInputElement>(null);
	useEffect(() => {
		nameRef.current?.focus();
	}, []);

	useEffect(() => {
		function onDown(e: MouseEvent) {
			if (wrap.current && !wrap.current.contains(e.target as Node)) onClose();
		}
		document.addEventListener("mousedown", onDown);
		return () => document.removeEventListener("mousedown", onDown);
	}, [onClose]);

	function toggle(projectId: string) {
		setSelected((prev) => {
			const next = new Set(prev);
			if (next.has(projectId)) next.delete(projectId);
			else next.add(projectId);
			return next;
		});
	}

	async function handleCreate() {
		const trimmed = name.trim();
		if (!trimmed) return;
		setErr(null);
		setIsPending(true);
		try {
			const id = await createMut.mutateAsync({ name: trimmed, agentKind });
			if (selected.size > 0) {
				await Promise.all([...selected].map((projectId) => linkMut.mutateAsync({ id, projectId })));
			}
			utils.crossRepoOrchestrators.list.invalidate();
			onCreated?.(id);
			onClose();
		} catch (e) {
			setErr(e instanceof Error ? e.message : "Failed to create");
			setIsPending(false);
		}
	}

	const projectList = projects.data ?? [];

	return (
		<div
			ref={wrap}
			className="absolute left-1 right-1 top-full z-50 mt-1 overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--bg-elevated)] shadow-[var(--shadow-lg)]"
			onKeyDown={(e) => {
				if (e.key === "Escape") onClose();
				if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleCreate();
			}}
		>
			<div className="px-[13px] py-[11px]">
				<input
					ref={nameRef}
					value={name}
					onChange={(e) => setName(e.target.value)}
					placeholder="Orchestrator name"
					className="mb-[10px] h-[30px] w-full rounded-[7px] border border-[var(--border)] bg-[var(--bg-base)] px-[10px] text-[13px] text-[var(--text)] outline-none transition-colors placeholder:text-[var(--text-quaternary)] focus:border-[var(--accent)]"
				/>

				<div className="mb-[6px] text-[10px] uppercase tracking-[0.04em] text-[var(--text-quaternary)]">
					Agent
				</div>
				<div className="mb-[11px] grid grid-cols-4 gap-[4px]">
					{AGENT_OPTIONS.map((opt) => {
						const active = agentKind === opt;
						return (
							<button
								key={opt}
								type="button"
								onClick={() => setAgentKind(opt)}
								className={[
									"rounded-[5px] border py-[3px] text-[11px] transition-colors",
									active
										? "border-[var(--accent)] bg-[var(--accent-subtle)] text-[var(--text)]"
										: "border-[var(--border)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]",
								].join(" ")}
							>
								{opt}
							</button>
						);
					})}
				</div>

				<div className="mb-[6px] flex items-baseline justify-between">
					<span className="text-[10px] uppercase tracking-[0.04em] text-[var(--text-quaternary)]">
						Link repos
					</span>
					{selected.size > 0 && (
						<span className="text-[10px] text-[var(--text-quaternary)]">
							{selected.size} selected
						</span>
					)}
				</div>
				{projectList.length === 0 ? (
					<div className="py-[6px] text-[11px] italic text-[var(--text-quaternary)]">
						No repos yet. Add a repo first.
					</div>
				) : (
					<div className="flex flex-wrap gap-[6px]">
						{projectList.map((p) => {
							const checked = selected.has(p.id);
							return (
								<button
									key={p.id}
									type="button"
									onClick={() => toggle(p.id)}
									className={[
										"inline-flex h-[26px] items-center gap-[6px] rounded-[13px] border px-[10px] font-mono text-[12px] transition-colors",
										checked
											? "border-[rgba(10,132,255,0.5)] bg-[var(--accent-subtle)] text-[var(--accent-hover)]"
											: "border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]",
									].join(" ")}
								>
									{checked && (
										<svg width="9" height="9" viewBox="0 0 9 9" fill="none" aria-hidden="true">
											<path
												d="M1.5 4.5L3.5 6.5L7.5 2.5"
												stroke="currentColor"
												strokeWidth="1.4"
												strokeLinecap="round"
												strokeLinejoin="round"
											/>
										</svg>
									)}
									{p.name}
								</button>
							);
						})}
					</div>
				)}

				{err && <div className="mt-[8px] text-[11px] text-[var(--danger,#ff5454)]">{err}</div>}
			</div>

			<div className="flex items-center justify-end gap-[8px] border-t border-[var(--border-subtle)] bg-[var(--bg-base)] px-[13px] py-[10px]">
				<button
					type="button"
					onClick={onClose}
					className="h-[28px] rounded-[7px] border border-[var(--border-subtle)] px-[11px] text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-overlay)]"
				>
					Cancel
				</button>
				<button
					type="button"
					onClick={handleCreate}
					disabled={!name.trim() || isPending}
					className="h-[28px] rounded-[7px] bg-[var(--accent)] px-[13px] text-[12px] font-semibold text-[var(--accent-foreground)] hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-40"
				>
					{isPending ? "Creating…" : "Create"}
				</button>
			</div>
		</div>
	);
}
