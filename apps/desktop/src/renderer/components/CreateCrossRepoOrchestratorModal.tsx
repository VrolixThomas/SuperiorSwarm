import { useEffect, useRef, useState } from "react";
import { trpc } from "../trpc/client";

type AgentKind = "claude" | "codex" | "gemini" | "opencode";

const AGENT_OPTIONS: AgentKind[] = ["claude", "codex", "gemini", "opencode"];

export function CreateCrossRepoOrchestratorModal({ onClose }: { onClose: () => void }) {
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

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[2px]"
			onClick={onClose}
			onKeyDown={onKey}
			role="presentation"
		>
			<dialog
				open
				className="block bg-[var(--bg-elevated)] rounded-[10px] border border-[var(--border)] shadow-[var(--shadow-md)] w-[440px] overflow-hidden p-0 text-[var(--text)]"
				onClick={(e) => e.stopPropagation()}
				onKeyDown={(e) => e.stopPropagation()}
				aria-labelledby="xro-create-title"
			>
				{/* Header */}
				<div className="px-5 pt-4 pb-3 border-b border-[var(--border-subtle)]">
					<div className="flex items-center gap-2">
						<svg
							aria-hidden="true"
							width="14"
							height="14"
							viewBox="0 0 14 14"
							fill="none"
							className="text-[var(--text-tertiary)]"
						>
							<circle cx="3" cy="7" r="2" stroke="currentColor" strokeWidth="1.2" />
							<circle cx="11" cy="7" r="2" stroke="currentColor" strokeWidth="1.2" />
							<circle cx="7" cy="7" r="1" fill="currentColor" />
						</svg>
						<h3 id="xro-create-title" className="text-[13px] font-medium text-[var(--text)]">
							New cross-repo orchestrator
						</h3>
					</div>
					<p className="mt-1 text-[11px] text-[var(--text-quaternary)] leading-snug">
						Coordinates work across multiple repos. Pick which to include — you can add or remove
						later.
					</p>
				</div>

				{/* Body */}
				<div className="px-5 py-4 space-y-4">
					<Field label="Name" htmlFor="xro-name">
						<input
							id="xro-name"
							ref={nameRef}
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="Auth migration"
							className="w-full bg-transparent border border-[var(--border)] rounded-[6px] px-2.5 py-1.5 text-[13px] text-[var(--text)] placeholder:text-[var(--text-quaternary)] focus:outline-none focus:border-[var(--accent)] transition-colors"
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
											"text-[12px] py-1 rounded-[5px] border transition-colors",
											active
												? "border-[var(--accent)] bg-[var(--accent-subtle)] text-[var(--text)]"
												: "border-[var(--border)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:border-[var(--border-strong)]",
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
							selected.size === 0
								? "Pick at least one — orchestrator can't do much without repos"
								: `${selected.size} selected`
						}
					>
						{projectList.length === 0 ? (
							<div className="text-[11px] text-[var(--text-quaternary)] italic py-2">
								No repos yet. Add a repo first, then create an orchestrator.
							</div>
						) : (
							<div className="max-h-[180px] overflow-y-auto rounded-[6px] border border-[var(--border)]">
								{projectList.map((p, i) => {
									const checked = selected.has(p.id);
									return (
										<button
											key={p.id}
											type="button"
											onClick={() => toggle(p.id)}
											className={[
												"flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors",
												i > 0 ? "border-t border-[var(--border-subtle)]" : "",
												checked
													? "bg-[var(--accent-subtle)] text-[var(--text)]"
													: "text-[var(--text-secondary)] hover:bg-[var(--bg-overlay)]",
											].join(" ")}
										>
											<span
												aria-hidden="true"
												className={[
													"flex h-3.5 w-3.5 items-center justify-center rounded-[3px] border transition-colors",
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
															stroke="white"
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
				<div className="px-5 py-3 border-t border-[var(--border-subtle)] flex items-center justify-between">
					<div className="text-[10px] text-[var(--text-quaternary)] tabular-nums">⌘↵ to create</div>
					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={onClose}
							className="px-3 py-1 text-[12px] text-[var(--text-tertiary)] hover:text-[var(--text)] rounded-[5px] transition-colors"
						>
							Cancel
						</button>
						<button
							type="button"
							onClick={handleCreate}
							disabled={!name.trim() || isPending}
							className="px-3 py-1 text-[12px] font-medium text-white bg-[var(--accent)] rounded-[5px] disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110 transition-all"
						>
							{isPending ? "Creating…" : "Create"}
						</button>
					</div>
				</div>
			</dialog>
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
