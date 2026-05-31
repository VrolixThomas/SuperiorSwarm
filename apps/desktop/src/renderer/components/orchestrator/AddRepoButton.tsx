import { useEffect, useRef, useState } from "react";
import { trpc } from "../../trpc/client";

export function AddRepoButton({ orchestratorId }: { orchestratorId: string }) {
	const [open, setOpen] = useState(false);
	const wrap = useRef<HTMLDivElement>(null);

	const utils = trpc.useUtils();
	const projects = trpc.projects.list.useQuery();
	const linked = trpc.crossRepoOrchestrators.listLinkedProjects.useQuery({ id: orchestratorId });
	const linkProject = trpc.crossRepoOrchestrators.linkProject.useMutation({
		onSuccess: () => {
			utils.crossRepoOrchestrators.listLinkedProjects.invalidate({ id: orchestratorId });
			utils.crossRepoOrchestrators.listMembers.invalidate({ id: orchestratorId });
		},
	});

	useEffect(() => {
		if (!open) return;
		function onDown(e: MouseEvent) {
			if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
		}
		document.addEventListener("mousedown", onDown);
		return () => document.removeEventListener("mousedown", onDown);
	}, [open]);

	const linkedIds = new Set(linked.data ?? []);
	const unlinked = (projects.data ?? []).filter((p) => !linkedIds.has(p.id));

	return (
		<div className="relative" ref={wrap}>
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				disabled={unlinked.length === 0}
				title={unlinked.length === 0 ? "All repos linked" : "Link another repo"}
				aria-expanded={open}
				className="inline-flex h-[24px] items-center gap-[5px] rounded-[7px] border border-[var(--border)] bg-[var(--bg-elevated)] px-[9px] text-[11.5px] font-medium text-[var(--text-secondary)] hover:border-[var(--border-active)] hover:text-[var(--text)] disabled:opacity-40"
			>
				<svg width="10" height="10" viewBox="0 0 11 11" fill="none" aria-hidden="true">
					<path
						d="M5.5 1.5v8M1.5 5.5h8"
						stroke="currentColor"
						strokeWidth="1.4"
						strokeLinecap="round"
					/>
				</svg>
				Add repo
			</button>
			{open && unlinked.length > 0 && (
				<div className="absolute right-0 top-full z-50 mt-1 min-w-[180px] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)] py-1 shadow-[var(--shadow-md)]">
					{unlinked.map((p) => (
						<button
							key={p.id}
							type="button"
							className="block w-full px-3 py-1.5 text-left text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-overlay)] hover:text-[var(--text)]"
							onClick={() => {
								linkProject.mutate({ id: orchestratorId, projectId: p.id });
								setOpen(false);
							}}
						>
							{p.name}
						</button>
					))}
				</div>
			)}
		</div>
	);
}
