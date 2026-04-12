import { useMemo } from "react";
import type { SolveSessionInfo } from "../../shared/solve-types";
import { formatRelativeTime } from "../../shared/tickets";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";
import { SolvingBanner } from "./SolvingBanner";

// ── Props ─────────────────────────────────────────────────────────────────────

interface AIFixesTabProps {
	workspaceId: string;
}

// ── Progress Summary ─────────────────────────────────────────────────────────

function ProgressSummary({
	resolved,
	pending,
	unclear,
}: {
	resolved: number;
	pending: number;
	unclear: number;
}) {
	return (
		<div className="flex items-center gap-3 text-[10px]">
			{resolved > 0 && (
				<span className="flex items-center gap-1">
					<span className="inline-block h-[5px] w-[5px] rounded-full bg-[#34c759]" />
					<span className="text-[var(--text-secondary)]">{resolved} resolved</span>
				</span>
			)}
			{pending > 0 && (
				<span className="flex items-center gap-1">
					<span className="inline-block h-[5px] w-[5px] rounded-full bg-[var(--text-quaternary)]" />
					<span className="text-[var(--text-secondary)]">{pending} pending</span>
				</span>
			)}
			{unclear > 0 && (
				<span className="flex items-center gap-1">
					<span className="inline-block h-[5px] w-[5px] rounded-full bg-[#ff453a]" />
					<span className="text-[var(--text-secondary)]">{unclear} unclear</span>
				</span>
			)}
		</div>
	);
}

// ── Compact Active State ─────────────────────────────────────────────────────

function ActiveState({
	session,
	workspaceId,
}: {
	session: SolveSessionInfo;
	workspaceId: string;
}) {
	const allComments = session.groups.flatMap((g) => g.comments);
	const resolved = allComments.filter(
		(c) => c.status === "fixed" || c.status === "wont_fix"
	).length;
	const unclear = allComments.filter((c) => c.status === "unclear").length;
	const pending = allComments.length - resolved - unclear;

	const nonReverted = session.groups.filter((g) => g.status !== "reverted");
	const approved = nonReverted.filter((g) => g.status === "approved").length;
	const submitted = nonReverted.filter((g) => g.status === "submitted").length;
	const total = nonReverted.length;

	return (
		<div className="flex flex-1 min-h-0 flex-col overflow-hidden bg-[var(--bg-base)]">
			{/* Compact summary */}
			<div className="px-4 py-3 border-b border-[var(--border)]">
				<div className="text-[13px] font-semibold text-[var(--text)] mb-2 leading-snug">
					{session.prTitle}
				</div>
				<ProgressSummary resolved={resolved} pending={pending} unclear={unclear} />
				<div className="mt-2 flex items-center gap-2 text-[10px] text-[var(--text-quaternary)]">
					<span>
						{submitted > 0 && `${submitted} pushed · `}
						{approved} / {total} groups approved
					</span>
				</div>
			</div>

			{/* Group names — read-only quick overview */}
			<div className="flex-1 overflow-y-auto px-4 py-2">
				{session.groups.map((group) => {
					const statusIcon =
						group.status === "submitted"
							? "✓"
							: group.status === "approved"
								? "●"
								: group.status === "reverted"
									? "✗"
									: "○";
					const statusColor =
						group.status === "submitted"
							? "var(--success)"
							: group.status === "approved"
								? "var(--accent)"
								: group.status === "reverted"
									? "var(--text-quaternary)"
									: "var(--text-tertiary)";
					return (
						<div key={group.id} className="flex items-center gap-2 py-[6px] text-[11.5px]">
							<span style={{ color: statusColor }} className="text-[10px] w-3 text-center">
								{statusIcon}
							</span>
							<span
								className={`flex-1 truncate ${group.status === "reverted" ? "line-through text-[var(--text-quaternary)]" : "text-[var(--text-secondary)]"}`}
							>
								{group.label}
							</span>
							<span className="text-[10px] text-[var(--text-quaternary)]">
								{
									group.comments.filter((c) => c.status === "fixed" || c.status === "wont_fix")
										.length
								}
								/{group.comments.length}
							</span>
						</div>
					);
				})}
			</div>

			{/* Open full review CTA */}
			<div className="shrink-0 border-t border-[var(--border)] px-4 py-3">
				<button
					type="button"
					onClick={() => useTabStore.getState().addSolveReviewTab(workspaceId, session.id)}
					className="w-full rounded-[8px] bg-[var(--accent)] px-4 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90"
				>
					Open Solve Review
				</button>
			</div>
		</div>
	);
}

// ── Main Component ────────────────────────────────────────────────────────────

export function AIFixesTab({ workspaceId }: AIFixesTabProps) {
	const utils = trpc.useUtils();

	const sessionsQuery = trpc.commentSolver.getSolveSessions.useQuery(
		{ workspaceId },
		{ staleTime: 5_000 }
	);

	const latestSession = useMemo(() => {
		const sessions = sessionsQuery.data ?? [];
		if (sessions.length === 0) return null;
		const sorted = [...sessions].sort(
			(a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
		);
		return sorted[0] ?? null;
	}, [sessionsQuery.data]);

	const sessionQuery = trpc.commentSolver.getSolveSession.useQuery(
		{ sessionId: latestSession?.id ?? "" },
		{
			enabled: !!latestSession?.id,
			staleTime: 5_000,
			refetchInterval:
				latestSession?.status === "in_progress" || latestSession?.status === "queued"
					? 3_000
					: false,
		}
	);

	const resetSession = trpc.commentSolver.resetFailedSession.useMutation({
		onSuccess: () => {
			utils.commentSolver.getSolveSession.invalidate();
			utils.commentSolver.getSolveSessions.invalidate({ workspaceId });
		},
	});
	const keepSession = trpc.commentSolver.keepFailedSession.useMutation({
		onSuccess: () => {
			utils.commentSolver.getSolveSession.invalidate();
			utils.commentSolver.getSolveSessions.invalidate({ workspaceId });
		},
	});

	const fullSession = sessionQuery.data ?? null;
	const isSolving = latestSession?.status === "queued" || latestSession?.status === "in_progress";

	if (fullSession && fullSession.status === "ready") {
		return (
			<div className="flex flex-1 min-h-0 flex-col bg-[var(--bg-base)]">
				{isSolving && <SolvingBanner />}
				<ActiveState session={fullSession} workspaceId={workspaceId} />
			</div>
		);
	}

	if (fullSession && fullSession.status === "failed") {
		return (
			<div className="flex flex-1 min-h-0 flex-col bg-[var(--bg-base)]">
				<div className="flex flex-1 flex-col items-center justify-center px-4">
					<div className="flex w-full max-w-sm flex-col gap-4 rounded-[10px] border border-[var(--border-destructive,#ff3b30)] bg-[var(--bg-surface)] p-4">
						<div className="flex flex-col gap-1">
							<span className="text-[13px] font-medium text-[var(--text)]">
								The solver stopped unexpectedly
							</span>
							{fullSession.lastActivityAt && (
								<span className="text-[12px] text-[var(--text-tertiary)]">
									Last activity:{" "}
									{formatRelativeTime(new Date(fullSession.lastActivityAt).toISOString())}
								</span>
							)}
						</div>

						<div className="flex gap-2">
							<button
								type="button"
								onClick={() => resetSession.mutate({ sessionId: fullSession.id })}
								disabled={resetSession.isPending || keepSession.isPending}
								className="flex-1 rounded-[6px] border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-[12px] font-medium text-[var(--text)] transition-colors hover:bg-[var(--bg-surface-hover)] disabled:opacity-50"
							>
								{resetSession.isPending ? "Reverting…" : "Reset & try again"}
							</button>
							<button
								type="button"
								onClick={() => keepSession.mutate({ sessionId: fullSession.id })}
								disabled={resetSession.isPending || keepSession.isPending}
								className="flex-1 rounded-[6px] bg-[var(--accent)] px-3 py-2 text-[12px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
							>
								{keepSession.isPending ? "Saving…" : "Keep partial changes"}
							</button>
						</div>

						{(resetSession.error ?? keepSession.error) && (
							<span className="text-[12px] text-[var(--text-destructive)]">
								{(resetSession.error ?? keepSession.error)?.message}
							</span>
						)}
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-1 min-h-0 flex-col bg-[var(--bg-base)]">
			{isSolving && <SolvingBanner />}
			<div className="flex flex-1 flex-col items-center justify-center gap-2">
				<span className="text-[13px] text-[var(--text-secondary)]">No AI fixes pending</span>
				<span className="text-[11px] text-[var(--text-quaternary)]">
					Use the Comments tab to trigger AI solving
				</span>
			</div>
		</div>
	);
}
