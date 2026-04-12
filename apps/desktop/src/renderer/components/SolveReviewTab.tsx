import { useEffect, useRef } from "react";
import type { SolveSessionInfo, SolveSessionStatus } from "../../shared/solve-types";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";
import { SolveCommitGroupCard } from "./SolveCommitGroupCard";

interface Props {
	workspaceId: string;
	solveSessionId: string;
}

export function SolveReviewTab({ workspaceId, solveSessionId }: Props) {
	const utils = trpc.useUtils();

	const { data: session, isLoading } = trpc.commentSolver.getSolveSession.useQuery(
		{ sessionId: solveSessionId },
		{
			refetchInterval: (query) => {
				const status = query.state.data?.status;
				return status === "queued" || status === "in_progress" ? 3000 : false;
			},
		}
	);

	const cancelMutation = trpc.commentSolver.cancelSolve.useMutation({
		onSuccess: () => utils.commentSolver.invalidate(),
	});

	const dismissMutation = trpc.commentSolver.dismissSolve.useMutation({
		onSuccess: () => utils.commentSolver.invalidate(),
	});

	const pushMutation = trpc.commentSolver.pushAndPost.useMutation({
		onSuccess: () => utils.commentSolver.invalidate(),
	});

	const prevStatusRef = useRef<SolveSessionStatus | undefined>(undefined);
	useEffect(() => {
		if (prevStatusRef.current === "in_progress" && session?.status === "ready") {
			useTabStore.getState().setActiveTab(`solve-review-${solveSessionId}`);
		}
		prevStatusRef.current = session?.status;
	}, [session?.status, solveSessionId]);

	if (isLoading || !session) {
		return <div className="p-6 text-[var(--text-secondary)]">Loading…</div>;
	}

	const isSolving = session.status === "queued" || session.status === "in_progress";
	const isCancelled = session.status === "cancelled";
	const isReady = session.status === "ready";

	const groups = session.groups ?? [];
	const allComments = groups.flatMap((g) => g.comments);
	const resolvedCount = allComments.filter(
		(c) => c.status === "fixed" || c.status === "wont_fix"
	).length;
	const pendingCount = allComments.filter((c) => c.status === "open").length;
	const unclearCount = allComments.filter((c) => c.status === "unclear").length;

	const approvedGroups = groups.filter((g) => g.status === "approved").length;
	const totalGroups = groups.filter((g) => g.status !== "reverted").length;
	const allApproved = approvedGroups === totalGroups && totalGroups > 0;

	const hasDraftReplies = groups.some((g) => g.comments.some((c) => c.reply?.status === "draft"));
	const canPush = allApproved && !hasDraftReplies && isReady;

	return (
		<div className="flex flex-col h-full overflow-hidden">
			<div className="flex-1 overflow-y-auto px-7 pt-[22px] pb-[18px]">
				<PRHeader
					session={session}
					isSolving={isSolving}
					onCancel={() => cancelMutation.mutate({ sessionId: solveSessionId })}
				/>
				<ProgressStrip
					resolvedCount={resolvedCount}
					pendingCount={pendingCount}
					unclearCount={unclearCount}
					approvedGroups={approvedGroups}
					totalGroups={totalGroups}
				/>
				<div className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-[var(--text-tertiary)] mb-2">
					{groups.length} Commit Groups
				</div>
				{groups.map((group, i) => (
					<SolveCommitGroupCard
						key={group.id}
						group={group}
						sessionId={solveSessionId}
						workspaceId={workspaceId}
						defaultExpanded={i === 0}
					/>
				))}
				{isCancelled && (
					<div className="mt-3 text-center">
						<button
							onClick={() => {
								/* re-solve handled in Task 9 */
							}}
							className="px-4 py-[6px] rounded-[6px] text-[12px] font-medium bg-[var(--accent-subtle)] text-[var(--accent)] border-none cursor-pointer"
						>
							Re-solve remaining comments
						</button>
					</div>
				)}
			</div>
			<BottomBar
				canPush={canPush}
				hasDraftReplies={hasDraftReplies}
				approvedGroups={approvedGroups}
				totalGroups={totalGroups}
				unclearCount={unclearCount}
				isPushing={pushMutation.isPending}
				onDismiss={() => dismissMutation.mutate({ sessionId: solveSessionId })}
				onPush={() => pushMutation.mutate({ sessionId: solveSessionId })}
			/>
		</div>
	);
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PRHeader({
	session,
	isSolving,
	onCancel,
}: {
	session: SolveSessionInfo;
	isSolving: boolean;
	onCancel: () => void;
}) {
	return (
		<div className="mb-5">
			<div className="flex justify-between items-center mb-[6px]">
				<div className="flex items-center gap-2">
					<span className="[font-family:var(--font-mono)] text-[11.5px] text-[var(--text-tertiary)]">
						{session.prIdentifier}
					</span>
					<span className="[font-family:var(--font-mono)] inline-flex items-center gap-[5px] px-2 py-[2px] bg-[var(--bg-elevated)] rounded-[4px] text-[10.5px] text-[var(--text-secondary)]">
						{session.sourceBranch}
						<span className="text-[var(--text-tertiary)] text-[9px]">→</span>
						{session.targetBranch}
					</span>
				</div>
				{isSolving && (
					<button
						onClick={onCancel}
						className="px-[10px] py-[4px] rounded-[6px] text-[11.5px] font-medium text-[var(--danger)] bg-[var(--danger-subtle)] border-none cursor-pointer"
					>
						Cancel solve
					</button>
				)}
			</div>
			<div className="text-[17px] font-semibold tracking-[-0.03em] leading-[1.35]">
				{session.prTitle}
			</div>
		</div>
	);
}

function StatusPill({
	color,
	bg,
	count,
	label,
}: {
	color: string;
	bg: string;
	count: number;
	label: string;
}) {
	return (
		<span
			style={{ background: bg, color }}
			className="inline-flex items-center gap-1 px-2 py-[2px] rounded-full text-[11px] font-medium"
		>
			<span className="w-1 h-1 rounded-full bg-current" />
			{count} {label}
		</span>
	);
}

function ProgressStrip({
	resolvedCount,
	pendingCount,
	unclearCount,
	approvedGroups,
	totalGroups,
}: {
	resolvedCount: number;
	pendingCount: number;
	unclearCount: number;
	approvedGroups: number;
	totalGroups: number;
}) {
	const pct = totalGroups > 0 ? (approvedGroups / totalGroups) * 100 : 0;
	return (
		<div className="mb-[22px]">
			<div className="flex justify-between items-center mb-[6px]">
				<div className="flex gap-[5px]">
					{resolvedCount > 0 && (
						<StatusPill
							color="var(--success)"
							bg="var(--success-subtle)"
							count={resolvedCount}
							label="resolved"
						/>
					)}
					{pendingCount > 0 && (
						<StatusPill
							color="var(--text-tertiary)"
							bg="var(--bg-elevated)"
							count={pendingCount}
							label="pending"
						/>
					)}
					{unclearCount > 0 && (
						<StatusPill
							color="var(--warning)"
							bg="var(--warning-subtle)"
							count={unclearCount}
							label="unclear"
						/>
					)}
				</div>
				<span className="[font-family:var(--font-mono)] text-[11px] text-[var(--text-tertiary)]">
					{approvedGroups} / {totalGroups} approved
				</span>
			</div>
			<div className="h-[2px] bg-[var(--bg-elevated)] rounded-[1px] overflow-hidden">
				<div
					className="h-full bg-[var(--success)] rounded-[1px]"
					style={{ width: `${pct}%`, transition: "width 0.5s ease" }}
				/>
			</div>
		</div>
	);
}

function BottomBar({
	canPush,
	hasDraftReplies,
	approvedGroups,
	totalGroups,
	unclearCount,
	isPushing,
	onDismiss,
	onPush,
}: {
	canPush: boolean;
	hasDraftReplies: boolean;
	approvedGroups: number;
	totalGroups: number;
	unclearCount: number;
	isPushing: boolean;
	onDismiss: () => void;
	onPush: () => void;
}) {
	const messages: string[] = [];
	if (hasDraftReplies) messages.push("draft replies need sign-off");
	if (approvedGroups < totalGroups) {
		const remaining = totalGroups - approvedGroups;
		messages.push(`${remaining} group${remaining > 1 ? "s" : ""} not yet approved`);
	}
	if (unclearCount > 0)
		messages.push(`${unclearCount} unclear comment${unclearCount > 1 ? "s" : ""} need attention`);

	return (
		<div className="px-7 py-3 border-t border-[var(--border-subtle)] flex items-center justify-between">
			<div className="text-[11.5px] text-[var(--text-tertiary)] flex items-center gap-[5px]">
				{messages.length > 0 && (
					<>
						<span className="text-[var(--warning)]">⚠</span>
						{messages.join(" · ")}
					</>
				)}
			</div>
			<div className="flex gap-[6px]">
				<button
					onClick={onDismiss}
					className="px-[14px] py-[6px] rounded-[6px] text-[12px] font-medium text-[var(--text-secondary)] bg-transparent border border-[var(--border-default)] cursor-pointer"
				>
					Dismiss
				</button>
				<button
					onClick={canPush && !isPushing ? onPush : undefined}
					disabled={!canPush || isPushing}
					className={`px-4 py-[6px] rounded-[6px] text-[12px] font-semibold border-none ${canPush && !isPushing ? "cursor-pointer bg-[var(--success)] text-[#0a0c0a] opacity-100" : "cursor-not-allowed bg-[var(--bg-active)] text-[var(--text-tertiary)] opacity-50"}`}
				>
					{isPushing ? "Pushing…" : "Push & post replies"}
				</button>
			</div>
		</div>
	);
}
