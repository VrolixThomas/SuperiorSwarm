import { useEffect, useRef, useState } from "react";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";

export function CrossRepoOrchestratorBody({ orchestratorId }: { orchestratorId: string }) {
	const linked = trpc.crossRepoOrchestrators.listLinkedProjects.useQuery({ id: orchestratorId });
	const members = trpc.crossRepoOrchestrators.listMembers.useQuery({ id: orchestratorId });
	const projects = trpc.projects.list.useQuery();
	const utils = trpc.useUtils();

	const linkProject = trpc.crossRepoOrchestrators.linkProject.useMutation({
		onSuccess: () => {
			utils.crossRepoOrchestrators.listLinkedProjects.invalidate({ id: orchestratorId });
		},
	});
	const unlinkProject = trpc.crossRepoOrchestrators.unlinkProject.useMutation({
		onSuccess: () => {
			utils.crossRepoOrchestrators.listLinkedProjects.invalidate({ id: orchestratorId });
			utils.crossRepoOrchestrators.listMembers.invalidate({ id: orchestratorId });
		},
	});

	const projectsById = new Map((projects.data ?? []).map((p) => [p.id, p]));
	const linkedIds = linked.data ?? [];
	const unlinkedProjects = (projects.data ?? []).filter((p) => !linkedIds.includes(p.id));

	return (
		<div className="pl-[26px] pr-1 pb-1.5">
			{/* Repos */}
			<Section label="Repos" count={linkedIds.length}>
				{linkedIds.length === 0 && <EmptyHint>No repos linked</EmptyHint>}
				{linkedIds.map((pid) => (
					<RepoLine
						key={pid}
						name={projectsById.get(pid)?.name ?? pid}
						onUnlink={() => unlinkProject.mutate({ id: orchestratorId, projectId: pid })}
					/>
				))}
				{unlinkedProjects.length > 0 && (
					<LinkRepoButton
						projects={unlinkedProjects}
						onPick={(projectId) => linkProject.mutate({ id: orchestratorId, projectId })}
					/>
				)}
			</Section>

			{/* Members */}
			<Section label="Members" count={members.data?.length ?? 0}>
				{(members.data ?? []).length === 0 ? (
					<EmptyHint>No members yet</EmptyHint>
				) : (
					(members.data ?? []).map((m) => (
						<ReferenceLine
							key={m.workspaceId}
							orchestratorId={orchestratorId}
							phase={m.currentPhase}
							repoName={projectsById.get(m.projectId)?.name ?? m.projectId}
							branch={m.workspaceName}
						/>
					))
				)}
			</Section>
		</div>
	);
}

function Section({
	label,
	count,
	children,
}: {
	label: string;
	count: number;
	children: React.ReactNode;
}) {
	return (
		<div className="mt-1.5 first:mt-0">
			<div className="flex items-center gap-1.5 px-2 py-0.5 text-[10px] text-[var(--text-quaternary)]">
				<span>{label}</span>
				<span className="tabular-nums">{count}</span>
			</div>
			<div className="mt-0.5">{children}</div>
		</div>
	);
}

function EmptyHint({ children }: { children: React.ReactNode }) {
	return (
		<div className="px-2 py-[3px] text-[11px] text-[var(--text-quaternary)] italic">{children}</div>
	);
}

function RepoLine({ name, onUnlink }: { name: string; onUnlink: () => void }) {
	return (
		<div className="group/repo flex items-center gap-1.5 rounded-[6px] px-2 py-[3px] hover:bg-[var(--bg-elevated)]">
			<svg
				aria-hidden="true"
				width="11"
				height="11"
				viewBox="0 0 11 11"
				fill="none"
				className="shrink-0 text-[var(--text-quaternary)]"
			>
				<path
					d="M2.5 1.5h5a1 1 0 0 1 1 1v6.5l-1.5-1-1.5 1-1.5-1-1.5 1V2.5a1 1 0 0 1 1-1Z"
					stroke="currentColor"
					strokeWidth="1"
					strokeLinejoin="round"
				/>
			</svg>
			<span className="flex-1 min-w-0 truncate text-[12px] text-[var(--text-secondary)]">
				{name}
			</span>
			<button
				type="button"
				onClick={onUnlink}
				className="opacity-0 group-hover/repo:opacity-100 focus:opacity-100 text-[var(--text-quaternary)] hover:text-[var(--text)] text-[12px] leading-none px-1"
				aria-label={`Unlink ${name}`}
				title="Unlink"
			>
				×
			</button>
		</div>
	);
}

function ReferenceLine({
	orchestratorId,
	phase,
	repoName,
	branch,
}: {
	orchestratorId: string;
	phase: "idle" | "working" | "blocked" | "done";
	repoName: string;
	branch: string;
}) {
	const openXroCanvas = useTabStore((s) => s.openXroCanvas);
	return (
		<button
			type="button"
			onClick={() => openXroCanvas(orchestratorId, repoName)}
			className="flex w-full items-center gap-[7px] rounded-[6px] px-2 py-[4px] text-left text-[11px] text-[var(--text-quaternary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-tertiary)]"
		>
			<span
				className="h-[6px] w-[6px] shrink-0 rounded-full"
				style={{ background: `var(--st-${phase})` }}
			/>
			<span className="truncate font-mono">
				{repoName} / {branch}
			</span>
		</button>
	);
}

function LinkRepoButton({
	projects,
	onPick,
}: {
	projects: Array<{ id: string; name: string }>;
	onPick: (projectId: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const wrap = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		function onDown(e: MouseEvent) {
			if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
		}
		document.addEventListener("mousedown", onDown);
		return () => document.removeEventListener("mousedown", onDown);
	}, [open]);

	return (
		<div className="relative mt-0.5" ref={wrap}>
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				className="flex items-center gap-1 rounded-[6px] px-2 py-[3px] text-[11px] text-[var(--text-quaternary)] hover:text-[var(--text-tertiary)] hover:bg-[var(--bg-elevated)] w-full"
			>
				<svg
					aria-hidden="true"
					width="10"
					height="10"
					viewBox="0 0 10 10"
					fill="none"
					className="shrink-0"
				>
					<path
						d="M5 1.5v7M1.5 5h7"
						stroke="currentColor"
						strokeWidth="1.2"
						strokeLinecap="round"
					/>
				</svg>
				<span>Link repo</span>
			</button>
			{open && (
				<div className="absolute left-0 top-full mt-1 z-50 min-w-[180px] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)] py-1 shadow-[var(--shadow-md)]">
					{projects.map((p) => (
						<button
							key={p.id}
							type="button"
							className="block w-full text-left px-3 py-1.5 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-overlay)] hover:text-[var(--text)]"
							onClick={() => {
								onPick(p.id);
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
