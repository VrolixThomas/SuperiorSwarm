import { useMemo } from "react";
import type { TicketProject } from "../../../shared/tickets";
import { useTabStore } from "../../stores/tab-store";
import { trpc } from "../../trpc/client";

export function TicketsSidebar() {
	const activeTicketProject = useTabStore((s) => s.activeTicketProject);
	const setActiveTicketProject = useTabStore((s) => s.setActiveTicketProject);

	const { data: atlassianStatus } = trpc.atlassian.getStatus.useQuery(undefined, {
		staleTime: 30_000,
	});
	const { data: linearStatus } = trpc.linear.getStatus.useQuery(undefined, {
		staleTime: 30_000,
	});

	const hasJira = atlassianStatus?.jira.connected;
	const hasLinear = linearStatus?.connected;

	const { data: jiraIssues } = trpc.atlassian.getMyIssues.useQuery(undefined, {
		enabled: hasJira,
		staleTime: 30_000,
	});
	const { data: linearIssues } = trpc.linear.getAssignedIssues.useQuery(undefined, {
		enabled: hasLinear,
		staleTime: 30_000,
	});

	const { jiraProjects, linearProjects, totalCount } = useMemo(() => {
		const jiraMap = new Map<string, number>();
		if (jiraIssues) {
			for (const issue of jiraIssues) {
				jiraMap.set(issue.projectKey, (jiraMap.get(issue.projectKey) ?? 0) + 1);
			}
		}

		const linearMap = new Map<string, { name: string; count: number }>();
		if (linearIssues) {
			for (const issue of linearIssues) {
				const existing = linearMap.get(issue.teamId);
				if (existing) {
					existing.count++;
				} else {
					linearMap.set(issue.teamId, { name: issue.teamName, count: 1 });
				}
			}
		}

		const jp: TicketProject[] = [...jiraMap.entries()].map(([key, count]) => ({
			id: key,
			name: key,
			provider: "jira" as const,
			count,
		}));

		const lp: TicketProject[] = [...linearMap.entries()].map(([id, { name, count }]) => ({
			id,
			name,
			provider: "linear" as const,
			count,
		}));

		return {
			jiraProjects: jp,
			linearProjects: lp,
			totalCount: (jiraIssues?.length ?? 0) + (linearIssues?.length ?? 0),
		};
	}, [jiraIssues, linearIssues]);

	const isActive = (project: { id: string; provider: "jira" | "linear" } | "all") => {
		if (project === "all") return activeTicketProject === "all";
		if (activeTicketProject === "all" || activeTicketProject === null) return false;
		return (
			activeTicketProject.id === project.id && activeTicketProject.provider === project.provider
		);
	};

	if (!hasJira && !hasLinear) {
		return (
			<div className="px-3 py-2 text-[12px] text-[var(--text-quaternary)]">
				No ticket services connected
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-1 px-2 py-1">
			{/* All Tickets */}
			<button
				type="button"
				onClick={() => setActiveTicketProject("all")}
				className={`flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-[11px] transition-colors duration-[120ms] ${
					isActive("all")
						? "bg-[rgba(10,132,255,0.08)] font-medium text-[var(--text)]"
						: "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
				}`}
			>
				<svg
					width="11"
					height="11"
					viewBox="0 0 16 16"
					fill="none"
					className="shrink-0"
					aria-hidden="true"
				>
					<rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" />
					<rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" />
					<rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" />
					<rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" />
				</svg>
				<span className="flex-1">All Tickets</span>
				<span className="text-[10px] tabular-nums text-[var(--text-quaternary)]">{totalCount}</span>
			</button>

			<div className="mx-2 my-1 h-px bg-[var(--border-subtle)]" />

			{jiraProjects.length > 0 && (
				<>
					<div className="px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.5px] text-[var(--text-quaternary)]">
						Jira
					</div>
					{jiraProjects.map((project) => (
						<button
							key={`jira-${project.id}`}
							type="button"
							onClick={() => setActiveTicketProject({ id: project.id, provider: "jira" })}
							className={`flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-[11px] transition-colors duration-[120ms] ${
								isActive({ id: project.id, provider: "jira" })
									? "bg-[rgba(10,132,255,0.08)] font-medium text-[var(--text)]"
									: "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
							}`}
						>
							<div className="h-[6px] w-[6px] shrink-0 rounded-[2px] bg-[var(--text-quaternary)]" />
							<span className="flex-1 truncate">{project.name}</span>
							<span className="text-[10px] tabular-nums text-[var(--text-quaternary)]">
								{project.count}
							</span>
						</button>
					))}
				</>
			)}

			{linearProjects.length > 0 && (
				<>
					{jiraProjects.length > 0 && <div className="mx-2 my-1 h-px bg-[var(--border-subtle)]" />}
					<div className="px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.5px] text-[var(--text-quaternary)]">
						Linear
					</div>
					{linearProjects.map((project) => (
						<button
							key={`linear-${project.id}`}
							type="button"
							onClick={() => setActiveTicketProject({ id: project.id, provider: "linear" })}
							className={`flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-[11px] transition-colors duration-[120ms] ${
								isActive({ id: project.id, provider: "linear" })
									? "bg-[rgba(10,132,255,0.08)] font-medium text-[var(--text)]"
									: "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
							}`}
						>
							<div className="h-[6px] w-[6px] shrink-0 rounded-full bg-[var(--text-quaternary)]" />
							<span className="flex-1 truncate">{project.name}</span>
							<span className="text-[10px] tabular-nums text-[var(--text-quaternary)]">
								{project.count}
							</span>
						</button>
					))}
				</>
			)}
		</div>
	);
}
