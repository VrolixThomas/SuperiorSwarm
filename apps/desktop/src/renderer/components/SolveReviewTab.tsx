import { useEffect, useRef } from "react";
import { trpc } from "../trpc/client";
import { useTabStore } from "../stores/tab-store";
import { SolveCommitGroupCard } from "./SolveCommitGroupCard";
import type { SolveGroupInfo, SolveSessionInfo } from "../../shared/solve-types";

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
		},
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

	const prevStatusRef = useRef(session?.status);
	useEffect(() => {
		if (prevStatusRef.current === "in_progress" && session?.status === "ready") {
			useTabStore.getState().setActiveTab(`solve-review-${solveSessionId}`);
		}
		prevStatusRef.current = session?.status;
	}, [session?.status, solveSessionId]);

	if (isLoading || !session) {
		return <div style={{ padding: 24, color: "var(--text-secondary)" }}>Loading…</div>;
	}

	const isSolving = session.status === "queued" || session.status === "in_progress";
	const isCancelled = session.status === "cancelled";
	const isReady = session.status === "ready";

	const groups = session.groups ?? [];
	const allComments = groups.flatMap((g) => g.comments);
	const resolvedCount = allComments.filter(
		(c) => c.status === "fixed" || c.status === "wont_fix",
	).length;
	const pendingCount = allComments.filter((c) => c.status === "open").length;
	const unclearCount = allComments.filter((c) => c.status === "unclear").length;

	const approvedGroups = groups.filter((g) => g.status === "approved").length;
	const totalGroups = groups.filter((g) => g.status !== "reverted").length;
	const allApproved = approvedGroups === totalGroups && totalGroups > 0;

	const hasDraftReplies = groups.some((g) =>
		g.comments.some((c) => c.reply?.status === "draft"),
	);
	const canPush = allApproved && !hasDraftReplies && isReady;

	return (
		<div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
			<div style={{ flex: 1, overflowY: "auto", padding: "22px 28px 18px" }}>
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
				<div
					style={{
						fontFamily: "'Outfit', var(--font-family)",
						fontSize: 10.5,
						fontWeight: 600,
						textTransform: "uppercase",
						letterSpacing: "0.07em",
						color: "var(--text-tertiary)",
						marginBottom: 8,
					}}
				>
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
					<div style={{ marginTop: 12, textAlign: "center" }}>
						<button
							onClick={() => {
								/* re-solve handled in Task 9 */
							}}
							style={{
								padding: "6px 16px",
								borderRadius: 6,
								fontSize: 12,
								fontWeight: 500,
								background: "var(--accent-subtle)",
								color: "var(--accent)",
								border: "none",
								cursor: "pointer",
							}}
						>
							Re-solve remaining comments
						</button>
					</div>
				)}
			</div>
			<BottomBar
				session={session}
				canPush={canPush}
				hasDraftReplies={hasDraftReplies}
				approvedGroups={approvedGroups}
				totalGroups={totalGroups}
				unclearCount={unclearCount}
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
		<div style={{ marginBottom: 20 }}>
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					marginBottom: 6,
				}}
			>
				<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
					<span
						style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--text-tertiary)" }}
					>
						{session.prIdentifier}
					</span>
					<span
						style={{
							display: "inline-flex",
							alignItems: "center",
							gap: 5,
							padding: "2px 8px",
							background: "var(--bg-elevated)",
							borderRadius: 4,
							fontFamily: "var(--font-mono)",
							fontSize: 10.5,
							color: "var(--text-secondary)",
						}}
					>
						{session.sourceBranch}
						<span style={{ color: "var(--text-tertiary)", fontSize: 9 }}>→</span>
						{session.targetBranch}
					</span>
				</div>
				{isSolving && (
					<button
						onClick={onCancel}
						style={{
							padding: "4px 10px",
							borderRadius: 6,
							fontSize: 11.5,
							fontWeight: 500,
							color: "var(--danger)",
							background: "var(--danger-subtle)",
							border: "none",
							cursor: "pointer",
						}}
					>
						Cancel solve
					</button>
				)}
			</div>
			<div
				style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-0.03em", lineHeight: 1.35 }}
			>
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
			style={{
				display: "inline-flex",
				alignItems: "center",
				gap: 4,
				padding: "2px 8px",
				borderRadius: 100,
				fontSize: 11,
				fontWeight: 500,
				background: bg,
				color,
			}}
		>
			<span
				style={{ width: 4, height: 4, borderRadius: "50%", background: "currentColor" }}
			/>
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
		<div style={{ marginBottom: 22 }}>
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					marginBottom: 6,
				}}
			>
				<div style={{ display: "flex", gap: 5 }}>
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
				<span
					style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-tertiary)" }}
				>
					{approvedGroups} / {totalGroups} approved
				</span>
			</div>
			<div
				style={{ height: 2, background: "var(--bg-elevated)", borderRadius: 1, overflow: "hidden" }}
			>
				<div
					style={{
						height: "100%",
						width: `${pct}%`,
						background: "var(--success)",
						borderRadius: 1,
						transition: "width 0.5s ease",
					}}
				/>
			</div>
		</div>
	);
}

function BottomBar({
	session: _session,
	canPush,
	hasDraftReplies,
	approvedGroups,
	totalGroups,
	unclearCount: _unclearCount,
	onDismiss,
	onPush,
}: {
	session: SolveSessionInfo;
	canPush: boolean;
	hasDraftReplies: boolean;
	approvedGroups: number;
	totalGroups: number;
	unclearCount: number;
	onDismiss: () => void;
	onPush: () => void;
}) {
	const messages: string[] = [];
	if (hasDraftReplies) messages.push("draft replies need sign-off");
	if (approvedGroups < totalGroups) {
		const remaining = totalGroups - approvedGroups;
		messages.push(`${remaining} group${remaining > 1 ? "s" : ""} not yet approved`);
	}

	return (
		<div
			style={{
				padding: "12px 28px",
				borderTop: "1px solid var(--border-subtle)",
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
			}}
		>
			<div
				style={{
					fontSize: 11.5,
					color: "var(--text-tertiary)",
					display: "flex",
					alignItems: "center",
					gap: 5,
				}}
			>
				{messages.length > 0 && (
					<>
						<span style={{ color: "var(--warning)" }}>⚠</span>
						{messages.join(" · ")}
					</>
				)}
			</div>
			<div style={{ display: "flex", gap: 6 }}>
				<button
					onClick={onDismiss}
					style={{
						padding: "6px 14px",
						borderRadius: 6,
						fontSize: 12,
						fontWeight: 500,
						color: "var(--text-secondary)",
						background: "transparent",
						border: "1px solid var(--border-default)",
						cursor: "pointer",
					}}
				>
					Dismiss
				</button>
				<button
					onClick={canPush ? onPush : undefined}
					disabled={!canPush}
					style={{
						padding: "6px 16px",
						borderRadius: 6,
						fontSize: 12,
						fontWeight: 600,
						border: "none",
						cursor: canPush ? "pointer" : "not-allowed",
						background: canPush ? "var(--success)" : "var(--bg-active)",
						color: canPush ? "#0a0c0a" : "var(--text-tertiary)",
						opacity: canPush ? 1 : 0.5,
					}}
				>
					Push &amp; post replies
				</button>
			</div>
		</div>
	);
}
