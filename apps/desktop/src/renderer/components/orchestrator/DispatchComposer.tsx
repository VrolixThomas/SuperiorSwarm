import { useEffect, useRef, useState } from "react";
import { trpc } from "../../trpc/client";

interface Target {
	projectId: string;
	name: string;
}

function slugify(task: string): string {
	const base = task
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 32);
	return `feat/${base || "task"}`;
}

export function DispatchComposer({
	orchestratorId,
	repos,
}: {
	orchestratorId: string;
	repos: Target[];
}) {
	const [task, setTask] = useState("");
	const [selected, setSelected] = useState<Set<string>>(new Set());

	// Reconcile the selection whenever the linked repo set changes (it loads
	// async and changes on link/unlink). Keep prior toggles, drop repos that are
	// gone, and auto-select newly linked repos. Keyed by the id list so the
	// effect does not fire on every render (repos is a fresh array each time).
	const repoIdsKey = repos.map((r) => r.projectId).join(",");
	const prevIdsRef = useRef<string[]>([]);
	useEffect(() => {
		const ids = repoIdsKey ? repoIdsKey.split(",") : [];
		setSelected((prev) => {
			const next = new Set<string>();
			for (const id of ids) {
				if (!prevIdsRef.current.includes(id) || prev.has(id)) next.add(id);
			}
			return next;
		});
		prevIdsRef.current = ids;
	}, [repoIdsKey]);

	const utils = trpc.useUtils();
	const dispatch = trpc.crossRepoOrchestrators.dispatch.useMutation({
		onSuccess: (res) => {
			if (res.failed.length === 0) setTask("");
			utils.crossRepoOrchestrators.listMembers.invalidate({ id: orchestratorId });
			utils.crossRepoOrchestrators.memberCounts.invalidate();
			// Dispatch creates worktrees in each target project — refresh the sidebar trees.
			utils.workspaces.listByProject.invalidate();
		},
	});

	function toggle(pid: string) {
		setSelected((prev) => {
			const next = new Set(prev);
			if (next.has(pid)) {
				next.delete(pid);
			} else {
				next.add(pid);
			}
			return next;
		});
	}

	function submit() {
		if (!task.trim() || selected.size === 0) return;
		dispatch.mutate({
			id: orchestratorId,
			task: task.trim(),
			targets: [...selected].map((projectId) => ({ projectId, branch: slugify(task) })),
		});
	}

	return (
		<div className="overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--bg-surface)] shadow-[var(--shadow-md)]">
			<div className="border-b border-[var(--border-subtle)] px-[13px] py-[10px] text-[11px] font-semibold uppercase tracking-[0.03em] text-[var(--text-quaternary)]">
				Dispatch across repos
			</div>
			<textarea
				value={task}
				onChange={(e) => setTask(e.target.value)}
				onKeyDown={(e) => {
					if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
				}}
				rows={2}
				placeholder="Describe a task to run across the selected repos…"
				className="w-full resize-none bg-transparent px-[15px] pb-[6px] pt-[14px] text-[14px] text-[var(--text)] outline-none placeholder:text-[var(--text-quaternary)]"
			/>
			<div className="flex flex-wrap items-center gap-[7px] px-[13px] pb-[13px] pt-[4px]">
				<span className="mr-[2px] text-[11.5px] text-[var(--text-quaternary)]">Route to</span>
				{repos.map((r) => {
					const on = selected.has(r.projectId);
					return (
						<button
							key={r.projectId}
							type="button"
							onClick={() => toggle(r.projectId)}
							className="inline-flex h-[26px] items-center gap-[6px] rounded-[13px] border px-[10px] text-[12px]"
							style={
								on
									? {
											borderColor: "rgba(10,132,255,0.5)",
											background: "var(--accent-subtle)",
											color: "var(--accent-hover)",
										}
									: {
											borderColor: "var(--border-subtle)",
											background: "var(--bg-elevated)",
											color: "var(--text-tertiary)",
										}
							}
						>
							{r.name}
						</button>
					);
				})}
			</div>
			<div className="flex items-center gap-[10px] border-t border-[var(--border-subtle)] bg-[var(--bg-base)] px-[13px] py-[11px]">
				<span className="flex-1 text-[11.5px] text-[var(--text-quaternary)]">
					Creates a branch + agent in each selected repo and hands the task to the orchestrator.
				</span>
				<button
					type="button"
					disabled={dispatch.isPending || !task.trim() || selected.size === 0}
					onClick={submit}
					className="h-[28px] rounded-[8px] bg-[var(--accent)] px-[13px] text-[12.5px] font-medium text-[var(--accent-foreground)] hover:bg-[var(--accent-hover)] disabled:opacity-40"
				>
					Dispatch
				</button>
			</div>
			{(dispatch.error || (dispatch.data && dispatch.data.failed.length > 0)) && (
				<div className="border-t border-[var(--border-subtle)] px-[13px] py-[8px] text-[11.5px] text-[var(--st-blocked)]">
					{dispatch.error
						? dispatch.error.message
						: dispatch.data?.failed
								.map((f) => {
									const name = repos.find((r) => r.projectId === f.projectId)?.name ?? f.projectId;
									return `${name}: ${f.error}`;
								})
								.join(" · ")}
				</div>
			)}
		</div>
	);
}
