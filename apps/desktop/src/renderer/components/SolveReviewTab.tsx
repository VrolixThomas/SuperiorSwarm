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
	const submittedGroups = groups.filter((g) => g.status === "submitted").length;
	const totalGroups = groups.filter((g) => g.status !== "reverted").length;

	// Draft reply info scoped to approved (not-yet-pushed) groups only
	const draftGroups = groups
		.filter((g) => g.status === "approved" && g.comments.some((c) => c.reply?.status === "draft"))
		.map((g) => g.label);
	const hasDraftRepliesInApproved = draftGroups.length > 0;
	const totalDraftReplies = groups.reduce(
		(n, g) => n + g.comments.filter((c) => c.reply?.status === "draft").length,
		0
	);
	// Push all: enabled when at least one approved group exists with no draft replies
	const canPushAll = approvedGroups > 0 && !hasDraftRepliesInApproved && isReady;

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
					submittedGroups={submittedGroups}
					totalGroups={totalGroups}
					totalDraftReplies={totalDraftReplies}
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
						{/* TODO: implement re-solve */}
						<button
							disabled
							className="px-4 py-[6px] rounded-[6px] text-[12px] font-medium bg-[var(--accent-subtle)] text-[var(--accent)] border-none opacity-40 cursor-not-allowed"
						>
							Re-solve remaining comments
						</button>
					</div>
				)}
			</div>
			<BottomBar
				canPush={canPushAll}
				isSolving={isSolving}
				draftGroups={draftGroups}
				approvedGroups={approvedGroups}
				totalGroups={totalGroups}
				submittedGroups={submittedGroups}
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
	submittedGroups,
	totalGroups,
	totalDraftReplies,
}: {
	resolvedCount: number;
	pendingCount: number;
	unclearCount: number;
	approvedGroups: number;
	submittedGroups: number;
	totalGroups: number;
	totalDraftReplies: number;
}) {
	const pct = totalGroups > 0 ? ((approvedGroups + submittedGroups) / totalGroups) * 100 : 0;
	return (
		<div className="mb-[22px]">
			{/* Row 1: comment-level review stats */}
			<div className="flex gap-[5px] mb-[10px]">
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
			{/* Row 2: group approval — gates push */}
			<div className="flex justify-between items-center mb-[5px]">
				<span className="text-[10px] font-semibold uppercase tracking-[0.07em] text-[var(--text-tertiary)]">
					Approval
				</span>
				<div className="flex items-center gap-[8px]">
					{totalDraftReplies > 0 && (
						<span className="text-[10.5px] text-[var(--warning)] font-medium">
							✉ {totalDraftReplies} draft {totalDraftReplies === 1 ? "reply" : "replies"}
						</span>
					)}
					<span className="[font-family:var(--font-mono)] text-[11px] text-[var(--text-tertiary)]">
						{submittedGroups > 0
							? `${submittedGroups} pushed · ${approvedGroups} approved / ${totalGroups}`
							: `${approvedGroups} / ${totalGroups} approved`}
					</span>
				</div>
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
	isSolving,
	draftGroups,
	approvedGroups,
	totalGroups,
	submittedGroups,
	isPushing,
	onDismiss,
	onPush,
}: {
	canPush: boolean;
	isSolving: boolean;
	draftGroups: string[];
	approvedGroups: number;
	totalGroups: number;
	submittedGroups: number;
	isPushing: boolean;
	onDismiss: () => void;
	onPush: () => void;
}) {
	const unhandledCount = totalGroups - approvedGroups - submittedGroups;
	const showCallout =
		!canPush && !isSolving && !isPushing && approvedGroups === 0 && unhandledCount === 0;

	// Label: "Push N approved" when some are already pushed, otherwise "Push & post replies"
	const pushLabel = isPushing
		? "Pushing…"
		: submittedGroups > 0
			? `Push ${approvedGroups} approved`
			: "Push & post replies";

	return (
		<div className="border-t border-[var(--border-subtle)]">
			{showCallout && (
				<div className="px-7 py-[10px] bg-[var(--warning-subtle)] flex flex-col gap-[4px]">
					{draftGroups.length > 0 && (
						<div className="text-[12px] font-medium text-[var(--warning)]">
							✉ Sign off draft replies in:{" "}
							{draftGroups.map((label, i) => (
								<span key={label}>
									{i > 0 && ", "}
									<span className="font-semibold">"{label}"</span>
								</span>
							))}
						</div>
					)}
				</div>
			)}
			<div className="px-7 py-3 flex items-center justify-end gap-[6px]">
				<button
					type="button"
					onClick={onDismiss}
					className="px-[14px] py-[6px] rounded-[6px] text-[12px] font-medium text-[var(--text-secondary)] bg-transparent border border-[var(--border-default)] cursor-pointer"
				>
					Dismiss
				</button>
				{approvedGroups > 0 && (
					<button
						type="button"
						onClick={canPush && !isPushing ? onPush : undefined}
						disabled={!canPush || isPushing}
						className={`px-4 py-[6px] rounded-[6px] text-[12px] font-semibold border-none ${canPush && !isPushing ? "cursor-pointer bg-[var(--success)] text-white opacity-100" : "cursor-not-allowed bg-[var(--bg-active)] text-[var(--text-tertiary)] opacity-50"}`}
					>
						{pushLabel}
					</button>
				)}
			</div>
		</div>
	);
}
