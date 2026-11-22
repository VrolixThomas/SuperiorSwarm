import { useEffect, useMemo, useState } from "react";
import type { PRContext } from "../../shared/github-types";
import { useRememberedReviewPath } from "../lib/review-path-status-cache";
import { type ReviewQueuePR, queueStatus } from "../lib/review-queue";
import {
	type ReviewSidebarFilters,
	buildAuthoredReviewPRs,
	filterReviewSidebarRows,
	parseReviewSidebarFilters,
} from "../lib/review-sidebar";
import { useReviewModeStore } from "../stores/review-mode-store";
import { useReviewPathSettingsStore } from "../stores/review-path-settings-store";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";
import { useReviewQueue } from "./review-mode/queue/useReviewQueue";

const FILTER_KEY = "ss.review-sidebar.filters.v1";
const EMPTY_PR: PRContext = {
	provider: "github",
	owner: "",
	repo: "",
	number: 0,
	title: "",
	sourceBranch: "",
	targetBranch: "",
	repoPath: "",
};
function readFilters() {
	try {
		return parseReviewSidebarFilters(window.localStorage.getItem(FILTER_KEY));
	} catch {
		return parseReviewSidebarFilters(null);
	}
}

function SidebarPRRow({
	pr,
	current,
	next,
	opening,
	onSelect,
}: {
	pr: ReviewQueuePR;
	current: boolean;
	next: boolean;
	opening: string | null;
	onSelect: (pr: ReviewQueuePR) => void;
}) {
	const remembered = useRememberedReviewPath(
		pr.headCommitSha
			? {
					provider: pr.provider,
					owner: pr.owner,
					repo: pr.repo,
					prNumber: pr.number,
					headSha: pr.headCommitSha,
					projectId: pr.projectId,
				}
			: undefined
	);
	const agentState = useTabStore((s) => {
		const workspaceId = Object.entries(s.workspaceMetadata).find(
			([, meta]) =>
				meta.type === "review" &&
				meta.prProvider === pr.provider &&
				meta.prIdentifier === `${pr.owner}/${pr.repo}#${pr.number}`
		)?.[0];
		return workspaceId
			? s
					.getTabsByWorkspace(workspaceId)
					.filter((t) => t.kind === "review-agent")
					.at(-1)?.state
			: undefined;
	});
	const status = queueStatus({ pathStatus: remembered?.path?.status });
	const label =
		agentState === "queued" || agentState === "preparing"
			? "Preparing"
			: agentState === "running"
				? "Mapping"
				: agentState === "needs-input"
					? "Needs input"
					: agentState === "failed"
						? "Agent failed"
						: status.label === "Status unavailable"
							? null
							: status.label;
	return (
		<button
			type="button"
			aria-current={current ? "page" : undefined}
			disabled={Boolean(opening)}
			onClick={() => onSelect(pr)}
			title={`${pr.title}\n${pr.owner}/${pr.repo} #${pr.number}`}
			className={`relative w-full rounded-[7px] border border-transparent px-[10px] py-[9px] text-left disabled:cursor-wait ${current ? "bg-[var(--accent-subtle)]" : "hover:bg-[var(--bg-elevated)]"}`}
		>
			{current && (
				<span
					aria-hidden="true"
					className="absolute bottom-2 left-0 top-2 w-[2px] rounded bg-[var(--accent)]"
				/>
			)}
			<span className="line-clamp-2 text-[13px] font-medium leading-[18px] text-[var(--text)]">
				{pr.title}
			</span>
			<span className="mt-[3px] flex items-center gap-1.5 text-[11px] text-[var(--text-tertiary)]">
				<span className="min-w-0 truncate">
					{pr.repo} #{pr.number}
				</span>
				{next && !current && (
					<span className="rounded bg-[var(--accent-subtle)] px-1 text-[var(--accent)]">Next</span>
				)}
				<span className="ml-auto shrink-0 text-[var(--text-secondary)]">
					{opening === pr.key ? "Opening…" : label}
				</span>
			</span>
		</button>
	);
}

export function ReviewPRSidebar() {
	const active = useReviewModeStore((s) => s.active);
	const queue = useReviewQueue(active?.prCtx ?? EMPTY_PR);
	const ghStatus = trpc.github.getStatus.useQuery(undefined, { staleTime: 30_000 });
	const bbStatus = trpc.atlassian.getStatus.useQuery(undefined, { staleTime: 30_000 });
	const github = trpc.github.getMyPRs.useQuery(undefined, {
		enabled: ghStatus.data?.connected === true,
		staleTime: 30_000,
	});
	const bitbucket = trpc.atlassian.getMyPullRequests.useQuery(undefined, {
		enabled: bbStatus.data?.bitbucket.connected === true,
		staleTime: 30_000,
	});
	const reviewRequests = trpc.atlassian.getReviewRequests.useQuery(undefined, {
		enabled: bbStatus.data?.bitbucket.connected === true,
		staleTime: 30_000,
	});
	const authored = useMemo(
		() => buildAuthoredReviewPRs({ github: github.data, bitbucket: bitbucket.data }),
		[github.data, bitbucket.data]
	);
	const [filters, setFilters] = useState(readFilters);
	const [refreshing, setRefreshing] = useState(false);
	useEffect(() => {
		try {
			window.localStorage.setItem(FILTER_KEY, JSON.stringify(filters));
		} catch {}
	}, [filters]);
	const all = [...queue.queue.needsReview, ...queue.queue.waitingOnAuthor, ...authored];
	const repositories = [
		...new Map(
			all.map((pr) => [
				`${pr.provider}:${pr.owner}/${pr.repo}`,
				`${pr.owner}/${pr.repo} · ${pr.provider === "github" ? "GitHub" : "Bitbucket"}`,
			])
		).entries(),
	].sort((a, b) => a[1].localeCompare(b[1]));
	const autoMap = useReviewPathSettingsStore((s) => s.autoMapOnReviewRequest);
	const setAutoMap = useReviewPathSettingsStore((s) => s.setAutoMapOnReviewRequest);
	const settingsError = useReviewPathSettingsStore((s) => s.error);
	const error = queue.error ?? bitbucket.error?.message;
	const sections: Array<{
		key: keyof ReviewSidebarFilters["sections"];
		label: string;
		rows: ReviewQueuePR[];
	}> = [
		{ key: "needsReview", label: "Needs your review", rows: queue.queue.needsReview },
		{ key: "authored", label: "Your PRs", rows: authored },
		{ key: "waitingOnAuthor", label: "Waiting on the author", rows: queue.queue.waitingOnAuthor },
	];
	const connected = ghStatus.data?.connected || bbStatus.data?.bitbucket.connected;
	const providerLoading = ghStatus.isLoading || bbStatus.isLoading;
	const githubLoading = ghStatus.data?.connected === true && github.isLoading;
	const loading = {
		authored:
			providerLoading ||
			githubLoading ||
			(bbStatus.data?.bitbucket.connected === true && bitbucket.isLoading),
		needsReview:
			providerLoading ||
			githubLoading ||
			(bbStatus.data?.bitbucket.connected === true && reviewRequests.isLoading),
		waitingOnAuthor:
			providerLoading ||
			githubLoading ||
			(bbStatus.data?.bitbucket.connected === true && reviewRequests.isLoading),
	};
	return (
		<section aria-label="Pull requests" className="flex h-full min-h-0 flex-col">
			<div className="app-drag flex h-[52px] shrink-0 items-center justify-between px-[14px]">
				<h2 className="text-[14px] font-semibold text-[var(--text)]">Pull requests</h2>
				<button
					type="button"
					aria-label="Refresh pull requests"
					title="Refresh pull requests"
					disabled={refreshing}
					className="app-no-drag size-7 rounded text-[var(--text-tertiary)] hover:bg-[var(--bg-elevated)] disabled:opacity-40"
					onClick={() => {
						setRefreshing(true);
						void Promise.all([
							queue.refresh(),
							bbStatus.data?.bitbucket.connected ? bitbucket.refetch() : Promise.resolve(),
						]).finally(() => setRefreshing(false));
					}}
				>
					<span aria-hidden="true">↻</span>
				</button>
			</div>
			<div className="space-y-2 border-b border-[var(--border-subtle)] px-[12px] pb-[12px]">
				<input
					aria-label="Filter pull requests"
					type="search"
					value={filters.search}
					onChange={(e) => setFilters({ ...filters, search: e.target.value })}
					placeholder="Filter pull requests"
					className="h-[30px] w-full rounded-[7px] border border-[var(--border)] bg-[var(--bg-base)] px-[9px] text-[12px] text-[var(--text)]"
				/>
				<select
					aria-label="Filter repositories"
					value={filters.repository}
					onChange={(e) => setFilters({ ...filters, repository: e.target.value })}
					className="h-[28px] w-full rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 text-[11px] text-[var(--text-secondary)]"
				>
					<option value="">All repositories</option>
					{filters.repository && !repositories.some(([key]) => key === filters.repository) && (
						<option value={filters.repository}>{filters.repository}</option>
					)}
					{repositories.map(([key, label]) => (
						<option key={key} value={key}>
							{label}
						</option>
					))}
				</select>
			</div>
			{error && (
				<p role="alert" className="px-3 py-2 text-[12px] text-[var(--term-red)]">
					{error}
				</p>
			)}
			<div className="min-h-0 flex-1 overflow-y-auto px-[6px] py-2">
				{!connected && ghStatus.data && bbStatus.data && (
					<p className="px-2 py-3 text-[12px] text-[var(--text-secondary)]">
						Connect GitHub or Bitbucket in Settings to see pull requests.
					</p>
				)}
				{sections.map((section) => {
					const rows = filterReviewSidebarRows(section.rows, filters);
					return (
						<div key={section.key} className="mb-2">
							<button
								type="button"
								aria-expanded={filters.sections[section.key]}
								aria-controls={`review-list-${section.key}`}
								onClick={() =>
									setFilters({
										...filters,
										sections: {
											...filters.sections,
											[section.key]: !filters.sections[section.key],
										},
									})
								}
								className="flex w-full items-center gap-1.5 px-2 py-2 text-left text-[11px] font-medium text-[var(--text-secondary)]"
							>
								<span aria-hidden="true">{filters.sections[section.key] ? "▾" : "▸"}</span>
								{section.label}
								<span className="ml-auto text-[var(--text-tertiary)]">
									{loading[section.key] && rows.length === 0 ? "…" : rows.length}
								</span>
							</button>
							{filters.sections[section.key] && (
								<div id={`review-list-${section.key}`}>
									{rows.map((pr) => (
										<SidebarPRRow
											key={pr.key}
											pr={pr}
											current={queue.currentKey === pr.key}
											next={queue.next?.key === pr.key}
											opening={queue.openingKey}
											onSelect={(pr) => {
												void queue.openPR(pr);
											}}
										/>
									))}
									{rows.length === 0 && (
										<p className="px-3 py-2 text-[11px] text-[var(--text-tertiary)]">
											{loading[section.key]
												? "Loading pull requests…"
												: filters.search || filters.repository
													? "No matching pull requests."
													: "No pull requests here."}
										</p>
									)}
								</div>
							)}
						</div>
					);
				})}
			</div>
			<div className="shrink-0 space-y-2 border-t border-[var(--border-subtle)] p-[12px]">
				<label className="flex items-start gap-2 text-[11px] leading-[16px] text-[var(--text-secondary)]">
					<input
						type="checkbox"
						checked={autoMap}
						onChange={(e) => setAutoMap(e.target.checked)}
						className="mt-0.5 accent-[var(--accent)]"
					/>
					Map new review requests automatically
				</label>
				{settingsError && (
					<p role="alert" className="text-[11px] text-[var(--term-red)]">
						{settingsError}
					</p>
				)}
				<p className="text-[11px] leading-[16px] text-[var(--text-tertiary)]">
					Projects and worktrees live under Projects in the rail.
				</p>
			</div>
		</section>
	);
}
