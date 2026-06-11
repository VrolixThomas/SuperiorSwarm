import { useEffect, useRef, useState } from "react";
import { useProjectStore } from "../stores/projects";
import { trpc } from "../trpc/client";

type AgentKind = "claude" | "codex" | "gemini" | "opencode";

const AGENT_OPTIONS: AgentKind[] = ["claude", "codex", "gemini", "opencode"];

export function CreateCrossRepoOrchestratorModal() {
	const isOpen = useProjectStore((s) => s.isCreateCrossRepoModalOpen);
	const onClose = useProjectStore((s) => s.closeCreateCrossRepoModal);
	if (!isOpen) return null;
	return <CreateCrossRepoOrchestratorModalInner onClose={onClose} />;
}

function CreateCrossRepoOrchestratorModalInner({ onClose }: { onClose: () => void }) {
	const [name, setName] = useState("");
	const [agentKind, setAgentKind] = useState<AgentKind>("claude");
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [isPending, setIsPending] = useState(false);
	const [err, setErr] = useState<string | null>(null);

	const utils = trpc.useUtils();
	const projects = trpc.projects.list.useQuery();
	const createMut = trpc.crossRepoOrchestrators.create.useMutation();
	const linkMut = trpc.crossRepoOrchestrators.linkProject.useMutation();

	const nameRef = useRef<HTMLInputElement>(null);
	useEffect(() => {
		nameRef.current?.focus();
	}, []);

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
			onClose();
		} catch (e) {
			setErr(e instanceof Error ? e.message : "Failed to create");
			setIsPending(false);
		}
	}

	function onKey(e: React.KeyboardEvent) {
		if (e.key === "Escape") onClose();
		if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleCreate();
	}

	const projectList = projects.data ?? [];

	const canCreate = name.trim().length > 0 && selected.size > 0 && !isPending;

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--scrim)] backdrop-blur-sm"
			onClick={(e) => {
				if (e.target === e.currentTarget) onClose();
			}}
			onKeyDown={onKey}
			role="presentation"
		>
			<div className="w-[460px] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text)] shadow-[var(--shadow-md)]">
				{/* Header */}
				<div className="flex items-start justify-between border-b border-[var(--border)] px-4 py-3">
					<div className="flex items-center gap-2.5">
						<span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[7px] border border-[rgba(138,154,176,0.35)] bg-[var(--orch-1-bg)]">
							<OrchestratorIcon size={14} color="var(--orch-1)" />
						</span>
						<div>
							<h2 id="xro-create-title" className="text-[14px] font-semibold text-[var(--text)]">
								New orchestrator
							</h2>
							<p className="mt-0.5 text-[11px] leading-snug text-[var(--text-quaternary)]">
								Coordinates work across the repos you pick. Add or remove them anytime.
							</p>
						</div>
					</div>
					<button
						type="button"
						onClick={onClose}
						aria-label="Close"
						className="-mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)]"
					>
						<svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none">
							<path
								d="M4 4l8 8M12 4l-8 8"
								stroke="currentColor"
								strokeWidth="1.5"
								strokeLinecap="round"
							/>
						</svg>
					</button>
				</div>

				{/* Body */}
				<div className="space-y-4 px-4 py-4">
					<Field label="Name" htmlFor="xro-name">
						<input
							id="xro-name"
							ref={nameRef}
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="Auth migration"
							className="w-full rounded-[6px] border border-[var(--border)] bg-transparent px-2.5 py-1.5 text-[13px] text-[var(--text)] transition-colors placeholder:text-[var(--text-quaternary)] focus:border-[var(--accent)] focus:outline-none"
						/>
					</Field>

					<Field label="Agent">
						<div className="grid grid-cols-4 gap-1">
							{AGENT_OPTIONS.map((opt) => {
								const active = agentKind === opt;
								return (
									<button
										key={opt}
										type="button"
										onClick={() => setAgentKind(opt)}
										className={[
											"rounded-[5px] border py-1 text-[12px] transition-colors",
											active
												? "border-[var(--accent)] bg-[var(--accent-subtle)] text-[var(--text)]"
												: "border-[var(--border)] text-[var(--text-tertiary)] hover:border-[var(--border-strong)] hover:text-[var(--text-secondary)]",
										].join(" ")}
									>
										{opt}
									</button>
								);
							})}
						</div>
					</Field>

					<Field
						label="Repos"
						hint={
							projectList.length === 0
								? undefined
								: selected.size === 0
									? "Pick at least one"
									: `${selected.size} of ${projectList.length} selected`
						}
					>
						{projectList.length === 0 ? (
							<div className="rounded-[6px] border border-dashed border-[var(--border)] px-3 py-2.5 text-[11px] italic text-[var(--text-quaternary)]">
								No repos yet. Add a repo first, then create an orchestrator.
							</div>
						) : (
							<div className="max-h-[200px] overflow-y-auto rounded-[6px] border border-[var(--border)]">
								{projectList.map((p, i) => {
									const checked = selected.has(p.id);
									return (
										<button
											key={p.id}
											type="button"
											onClick={() => toggle(p.id)}
											aria-pressed={checked}
											className={[
												"flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[12px] transition-colors",
												i > 0 ? "border-t border-[var(--border-subtle)]" : "",
												checked
													? "bg-[var(--accent-subtle)] text-[var(--text)]"
													: "text-[var(--text-secondary)] hover:bg-[var(--bg-overlay)]",
											].join(" ")}
										>
											<span
												aria-hidden="true"
												className={[
													"flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border transition-colors",
													checked
														? "border-[var(--accent)] bg-[var(--accent)]"
														: "border-[var(--border)] bg-transparent",
												].join(" ")}
											>
												{checked && (
													<svg
														width="9"
														height="9"
														viewBox="0 0 9 9"
														fill="none"
														aria-hidden="true"
													>
														<path
															d="M1.5 4.5L3.5 6.5L7.5 2.5"
															stroke="var(--accent-foreground)"
															strokeWidth="1.4"
															strokeLinecap="round"
															strokeLinejoin="round"
														/>
													</svg>
												)}
											</span>
											<span className="truncate">{p.name}</span>
										</button>
									);
								})}
							</div>
						)}
					</Field>

					{err && <div className="text-[11px] text-[var(--danger,#ff5454)]">{err}</div>}
				</div>

				{/* Footer */}
				<div className="flex items-center justify-between border-t border-[var(--border)] px-4 py-3">
					<div className="text-[10px] tabular-nums text-[var(--text-quaternary)]">⌘↵ to create</div>
					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={onClose}
							className="rounded-[6px] border border-[var(--border-subtle)] px-3 py-1 text-[12px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]"
						>
							Cancel
						</button>
						<button
							type="button"
							onClick={handleCreate}
							disabled={!canCreate}
							className="rounded-[6px] bg-[var(--accent)] px-3 py-1 text-[12px] font-semibold text-[var(--accent-foreground)] transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-40"
						>
							{isPending ? "Creating…" : "Create"}
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}

function Field({
	label,
	hint,
	htmlFor,
	children,
}: {
	label: string;
	hint?: string;
	htmlFor?: string;
	children: React.ReactNode;
}) {
	return (
		<div>
			<div className="mb-1.5 flex items-baseline justify-between">
				<label
					htmlFor={htmlFor}
					className="text-[11px] text-[var(--text-tertiary)] tracking-[0.02em]"
				>
					{label}
				</label>
				{hint && <span className="text-[10px] text-[var(--text-quaternary)]">{hint}</span>}
			</div>
			{children}
		</div>
	);
}
