import { useMemo, useState } from "react";
import type { SolveGroupInfo, SolveSessionInfo } from "../../shared/solve-types";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";
import { CommentGroupDetail } from "./CommentGroupDetail";
import { CommentGroupItem } from "./CommentGroupItem";
import { SolveActionBar } from "./SolveActionBar";

interface CommentSolvePanelProps {
	workspaceId: string;
}

// ── Empty state: no active session ────────────────────────────────────────────

function EmptyState({
	workspaceId,
	isLoading,
}: {
	workspaceId: string;
	isLoading: boolean;
}) {
	const triggerSolve = trpc.commentSolver.triggerSolve.useMutation();
	const attachTerminal = trpc.workspaces.attachTerminal.useMutation();
	const utils = trpc.useUtils();

	const handleSolve = () => {
		triggerSolve.mutate(
			{ workspaceId },
			{
				onSuccess: (launchInfo) => {
					utils.commentSolver.getSolveSessions.invalidate({ workspaceId });

					// Create a terminal tab for the solve process
					const tabStore = useTabStore.getState();
					const tabId = tabStore.addTerminalTab(
						launchInfo.workspaceId,
						launchInfo.worktreePath,
						"Comment Solver"
					);
					attachTerminal.mutate({
						workspaceId: launchInfo.workspaceId,
						terminalId: tabId,
					});

					setTimeout(() => {
						window.electron.terminal.write(tabId, `bash '${launchInfo.launchScript}'\r`);
					}, 1000);
				},
			}
		);
	};

	return (
		<div className="flex h-full flex-col items-center justify-center gap-4 bg-[var(--bg-base)]">
			{isLoading ? (
				<>
					{[1, 2, 3].map((i) => (
						<div
							key={i}
							className="h-3 animate-pulse rounded bg-[var(--bg-elevated)]"
							style={{ width: `${180 - i * 30}px` }}
						/>
					))}
					<div className="mt-2 text-[11px] text-[var(--text-quaternary)]">Loading sessions...</div>
				</>
			) : (
				<>
					<div className="text-[13px] text-[var(--text-quaternary)]">No active solve session</div>
					<button
						type="button"
						onClick={handleSolve}
						disabled={triggerSolve.isPending}
						className="rounded-[6px] bg-[var(--accent)] px-4 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-50"
					>
						{triggerSolve.isPending ? "Starting..." : "Solve Comments"}
					</button>
					{triggerSolve.isError && (
						<div className="max-w-[300px] text-center text-[11px] text-[#ff453a]">
							{triggerSolve.error.message}
						</div>
					)}
				</>
			)}
		</div>
	);
}

// ── Session header ────────────────────────────────────────────────────────────

function SessionHeader({
	session,
	onDismiss,
}: {
	session: SolveSessionInfo;
	onDismiss: () => void;
}) {
	const prNumber = session.prIdentifier.match(/#(\d+)$/)?.[1] ?? "";
	const totalComments = session.groups.reduce((sum, g) => sum + g.comments.length, 0);
	const dismissSolve = trpc.commentSolver.dismissSolve.useMutation();
	const utils = trpc.useUtils();

	const handleDismiss = () => {
		dismissSolve.mutate(
			{ sessionId: session.id },
			{
				onSuccess: () => {
					utils.commentSolver.getSolveSessions.invalidate({
						workspaceId: session.workspaceId,
					});
					onDismiss();
				},
			}
		);
	};

	const statusLabel: Record<string, { text: string; color: string }> = {
		queued: { text: "Queued", color: "var(--text-quaternary)" },
		in_progress: { text: "In Progress", color: "#ffd54f" },
		ready: { text: "Ready", color: "#6fdb6f" },
		submitted: { text: "Submitted", color: "#0a84ff" },
		failed: { text: "Failed", color: "#ff6b6b" },
	};

	const status = statusLabel[session.status] ?? statusLabel.queued;

	return (
		<div className="shrink-0 border-b border-[var(--border)] px-4 py-3">
			<div className="flex items-center gap-2">
				<h1 className="min-w-0 flex-1 truncate text-[14px] font-semibold text-[var(--text)]">
					{session.prTitle}
				</h1>
				<button
					type="button"
					onClick={handleDismiss}
					disabled={dismissSolve.isPending}
					className="shrink-0 text-[10px] text-[var(--text-quaternary)] hover:text-[#ff6b6b] transition-colors disabled:opacity-50"
				>
					{dismissSolve.isPending ? "Dismissing..." : "Dismiss"}
				</button>
			</div>
			<div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
				{prNumber && <span className="text-[var(--text-tertiary)]">#{prNumber}</span>}
				<span className="text-[var(--text-quaternary)]">&middot;</span>
				<span className="text-[var(--text-quaternary)]">
					{totalComments} comment{totalComments !== 1 ? "s" : ""}
				</span>
				<span className="text-[var(--text-quaternary)]">&middot;</span>
				<span style={{ color: status.color }}>{status.text}</span>
			</div>
		</div>
	);
}

// ── Session content ───────────────────────────────────────────────────────────

function SessionContent({ session }: { session: SolveSessionInfo }) {
	const [selectedGroupId, setSelectedGroupId] = useState<string | null>(
		session.groups[0]?.id ?? null
	);

	const selectedGroup = useMemo(
		() => session.groups.find((g) => g.id === selectedGroupId) ?? null,
		[session.groups, selectedGroupId]
	);

	// A group can be reverted only if no later non-reverted groups exist
	const canRevert = (group: SolveGroupInfo): boolean => {
		if (group.status === "reverted" || group.status === "pending") return false;
		const laterGroups = session.groups.filter(
			(g) => g.order > group.order && g.status !== "reverted"
		);
		return laterGroups.length === 0;
	};

	const utils = trpc.useUtils();

	const handleRevert = () => {
		utils.commentSolver.getSolveSession.invalidate({ sessionId: session.id });
	};

	const handlePushSuccess = () => {
		utils.commentSolver.getSolveSessions.invalidate({ workspaceId: session.workspaceId });
		utils.commentSolver.getSolveSession.invalidate({ sessionId: session.id });
	};

	if (session.groups.length === 0) {
		return (
			<div className="flex flex-1 items-center justify-center">
				<span className="text-[12px] text-[var(--text-quaternary)]">
					{session.status === "in_progress" || session.status === "queued"
						? "AI is working on your comments..."
						: "No fix groups created"}
				</span>
			</div>
		);
	}

	return (
		<div className="flex flex-1 flex-col overflow-hidden">
			<div className="flex flex-1 overflow-hidden">
				{/* Left: group list sidebar */}
				<div className="flex w-[200px] shrink-0 flex-col overflow-hidden border-r border-[var(--border)]">
					<div className="shrink-0 px-3 py-2">
						<span className="text-[10px] font-medium uppercase tracking-[0.05em] text-[var(--text-quaternary)]">
							Fix Groups
						</span>
					</div>
					<div className="flex-1 overflow-y-auto">
						{session.groups.map((group) => (
							<CommentGroupItem
								key={group.id}
								group={group}
								isSelected={group.id === selectedGroupId}
								onClick={() => setSelectedGroupId(group.id)}
							/>
						))}
					</div>
				</div>

				{/* Right: group detail */}
				<div className="flex flex-1 flex-col overflow-hidden">
					{selectedGroup ? (
						<CommentGroupDetail
							group={selectedGroup}
							sessionId={session.id}
							onRevert={handleRevert}
							canRevert={canRevert(selectedGroup)}
						/>
					) : (
						<div className="flex flex-1 items-center justify-center">
							<span className="text-[12px] text-[var(--text-quaternary)]">
								Select a group to view details
							</span>
						</div>
					)}
				</div>
			</div>

			{/* Bottom: action bar */}
			<SolveActionBar
				sessionId={session.id}
				groups={session.groups}
				onPushSuccess={handlePushSuccess}
			/>
		</div>
	);
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function CommentSolvePanel({ workspaceId }: CommentSolvePanelProps) {
	// Get all non-dismissed sessions for this workspace
	const sessionsQuery = trpc.commentSolver.getSolveSessions.useQuery(
		{ workspaceId },
		{ staleTime: 5_000 }
	);

	// Find the latest non-dismissed session
	const latestSession = useMemo(() => {
		const sessions = sessionsQuery.data ?? [];
		if (sessions.length === 0) return null;
		// Sort by createdAt descending, pick the first
		const sorted = [...sessions].sort(
			(a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
		);
		return sorted[0] ?? null;
	}, [sessionsQuery.data]);

	// Fetch full session data if we have one
	const sessionQuery = trpc.commentSolver.getSolveSession.useQuery(
		{ sessionId: latestSession?.id ?? "" },
		{
			enabled: !!latestSession?.id,
			staleTime: 5_000,
			// Refetch while in progress to pick up new groups
			refetchInterval:
				latestSession?.status === "in_progress" || latestSession?.status === "queued"
					? 3_000
					: false,
		}
	);

	const fullSession = sessionQuery.data ?? null;

	// No active session state
	if (!latestSession) {
		return <EmptyState workspaceId={workspaceId} isLoading={sessionsQuery.isLoading} />;
	}

	// Session exists but still loading full data
	if (!fullSession) {
		return (
			<div className="flex h-full flex-col items-center justify-center gap-3 bg-[var(--bg-base)]">
				{[1, 2, 3].map((i) => (
					<div
						key={i}
						className="h-3 animate-pulse rounded bg-[var(--bg-elevated)]"
						style={{ width: `${180 - i * 30}px` }}
					/>
				))}
				<div className="mt-2 text-[11px] text-[var(--text-quaternary)]">Loading session...</div>
			</div>
		);
	}

	return (
		<div className="flex h-full flex-col overflow-hidden bg-[var(--bg-base)]">
			<SessionHeader
				session={fullSession}
				onDismiss={() => {
					// Session dismissed, query will refetch and show empty state
				}}
			/>
			<SessionContent session={fullSession} />
		</div>
	);
}
