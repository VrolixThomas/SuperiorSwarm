import {
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	type ThreadFilter,
	draftStatusAfterEdit,
	fileCommentCounts,
} from "../../lib/pr-review-threads";
import { openThreadInChanges } from "../../lib/review-mode-nav";
import { useReviewModeStore } from "../../stores/review-mode-store";
import { trpc } from "../../trpc/client";
import { AgentStatusChip } from "./AgentStatusChip";
import { ReviewHeader } from "./ReviewHeader";
import { SubmitReviewPopover } from "./SubmitReviewPopover";
import { TerminalDrawer } from "./TerminalDrawer";
import { useReviewKeymap } from "./hooks/useReviewKeymap";
import { ReviewNavigator } from "./navigator/ReviewNavigator";
import type { ThreadCallbacks } from "./thread/ThreadCard";
import { useReviewAgentActions } from "./useReviewAgentActions";
import { useReviewData } from "./useReviewData";
import { ChangesView } from "./views/ChangesView";
import { CommentsView } from "./views/CommentsView";
import { OverviewView } from "./views/OverviewView";

type ActiveReview = NonNullable<ReturnType<typeof useReviewModeStore.getState>["active"]>;

export function ReviewModeShell() {
	const active = useReviewModeStore((s) => s.active);

	if (!active) return null;

	return <ActiveReviewModeShell active={active} />;
}

function ActiveReviewModeShell({ active }: { active: ActiveReview }) {
	const { workspaceId, prCtx } = active;
	const view = useReviewModeStore((s) => s.view);
	const setView = useReviewModeStore((s) => s.setView);
	const setCommentFilter = useReviewModeStore((s) => s.setCommentFilter);
	const setDrawerOpen = useReviewModeStore((s) => s.setDrawerOpen);
	const navigatorCollapsed = useReviewModeStore((s) => s.navigatorCollapsed);
	const [submitOpen, setSubmitOpen] = useState(false);
	const [navigatorWidth, setNavigatorWidth] = useState(280);
	const shellRef = useRef<HTMLDivElement>(null);
	const navRef = useRef<HTMLElement>(null);
	const utils = trpc.useUtils();
	const {
		details,
		isLoading,
		matchingDraft,
		activeDraft,
		aiDraft,
		allThreads,
		acceptedThreads,
		pendingCount,
		counts,
		sessionKey,
		fileOrder,
	} = useReviewData(workspaceId, prCtx);
	const commentCount = (counts.pending ?? 0) + (counts.open ?? 0);
	const commentCountByFile = useMemo(() => fileCommentCounts(allThreads), [allThreads]);
	const reviewChainId =
		activeDraft?.reviewChainId ??
		aiDraft?.reviewChainId ??
		matchingDraft?.reviewChainId ??
		matchingDraft?.id ??
		null;
	const agentActions = useReviewAgentActions({
		prCtx,
		matchingDraft: activeDraft ?? matchingDraft,
		reviewChainId,
	});

	const invalidateDrafts = useCallback(() => {
		void utils.aiReview.getReviewDrafts.invalidate();
		void utils.aiReview.getReviewDraft.invalidate();
	}, [utils]);

	const invalidateDetails = useCallback(() => {
		void utils.projects.getPRDetails.invalidate({
			provider: prCtx.provider,
			owner: prCtx.owner,
			repo: prCtx.repo,
			number: prCtx.number,
		});
	}, [prCtx.number, prCtx.owner, prCtx.provider, prCtx.repo, utils]);

	const { mutate: updateDraftComment } = trpc.aiReview.updateDraftComment.useMutation({
		onSuccess: invalidateDrafts,
	});
	const { mutate: deleteDraftComment } = trpc.aiReview.deleteDraftComment.useMutation({
		onSuccess: invalidateDrafts,
	});
	const { mutate: addReviewComment } = trpc.github.addReviewComment.useMutation({
		onSuccess: invalidateDetails,
	});
	const { mutate: resolveThread } = trpc.github.resolveThread.useMutation({
		onSuccess: invalidateDetails,
	});
	const { mutate: replyToPRComment } = trpc.atlassian.replyToPRComment.useMutation({
		onSuccess: invalidateDetails,
	});
	const { mutate: resolvePRComment } = trpc.atlassian.resolvePRComment.useMutation({
		onSuccess: invalidateDetails,
	});

	const callbacks = useMemo<ThreadCallbacks>(
		() => ({
			onAccept: (commentId) => updateDraftComment({ commentId, status: "user-pending" }),
			onDecline: (commentId) => updateDraftComment({ commentId, status: "rejected" }),
			onDelete: (commentId) => deleteDraftComment({ commentId }),
			onSaveEdit: (commentId, body, status) =>
				updateDraftComment({
					commentId,
					status: draftStatusAfterEdit(status),
					userEdit: body,
				}),
			onReply: (threadId, body) => {
				if (prCtx.provider === "github") {
					addReviewComment({ threadId, body });
					return;
				}

				replyToPRComment({
					workspace: prCtx.owner,
					repoSlug: prCtx.repo,
					prId: prCtx.number,
					parentCommentId: Number.parseInt(threadId, 10),
					body,
				});
			},
			onResolve: (threadId) => {
				if (prCtx.provider === "github") {
					resolveThread({ threadId });
					return;
				}

				resolvePRComment({
					workspace: prCtx.owner,
					repoSlug: prCtx.repo,
					prId: prCtx.number,
					commentId: Number.parseInt(threadId, 10),
					resolved: true,
				});
			},
			onOpenInChanges: (path, threadId) => openThreadInChanges(workspaceId, prCtx, path, threadId),
		}),
		[
			addReviewComment,
			deleteDraftComment,
			prCtx,
			replyToPRComment,
			resolvePRComment,
			resolveThread,
			updateDraftComment,
			workspaceId,
		]
	);

	const jumpToComments = useCallback(
		(filter: ThreadFilter) => {
			setCommentFilter(filter);
			setView("comments");
		},
		[setCommentFilter, setView]
	);

	const handleSubmitted = useCallback(() => {
		setSubmitOpen(false);
		invalidateDrafts();
		invalidateDetails();
		void utils.github.getMyPRs.invalidate();
	}, [invalidateDetails, invalidateDrafts, utils]);

	useEffect(() => {
		shellRef.current?.focus();
	}, []);

	const resizeNavigatorBy = useCallback((delta: number) => {
		setNavigatorWidth((width) => Math.min(360, Math.max(220, width + delta)));
	}, []);

	const startNavigatorResize = useCallback(
		(event: ReactPointerEvent<HTMLDivElement>) => {
			event.preventDefault();
			const startX = event.clientX;
			const startWidth = navigatorWidth;
			let latest = startWidth;
			let frame = 0;

			function onPointerMove(moveEvent: PointerEvent) {
				latest = Math.min(360, Math.max(220, startWidth + moveEvent.clientX - startX));
				if (frame) return;
				frame = requestAnimationFrame(() => {
					frame = 0;
					if (navRef.current) navRef.current.style.width = `${latest}px`;
				});
			}

			function onPointerUp() {
				cancelAnimationFrame(frame);
				setNavigatorWidth(latest);
				window.removeEventListener("pointermove", onPointerMove);
				window.removeEventListener("pointerup", onPointerUp);
			}

			window.addEventListener("pointermove", onPointerMove);
			window.addEventListener("pointerup", onPointerUp);
		},
		[navigatorWidth]
	);

	useReviewKeymap({
		workspaceId,
		prCtx,
		sessionKey,
		view,
		allThreads,
		fileOrder,
		callbacks,
	});

	return (
		<div
			ref={shellRef}
			tabIndex={-1}
			className="fixed inset-0 z-40 flex flex-col bg-[var(--bg-base)] outline-none"
		>
			<ReviewHeader
				prCtx={prCtx}
				commentCount={commentCount}
				rightSlot={
					<div
						className="relative flex items-center gap-2"
						onPointerDown={(event) => event.stopPropagation()}
					>
						<AgentStatusChip
							active={agentActions.isReviewActive}
							startedAt={agentActions.startedAt}
							canceling={agentActions.isPending}
							onOpen={() => setDrawerOpen(true)}
							onCancel={agentActions.cancel}
						/>
						<button
							type="button"
							disabled={agentActions.isPending}
							onClick={() => void agentActions.trigger()}
							className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-3 py-1.5 text-[12px] font-medium text-[var(--text-secondary)] transition-colors duration-[120ms] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-50"
						>
							{agentActions.isPending ? "Starting..." : agentActions.label}
						</button>
						<button
							type="button"
							onClick={() => setSubmitOpen((open) => !open)}
							className="rounded-[var(--radius-sm)] bg-[var(--accent)] px-3 py-1.5 text-[12px] font-semibold text-[var(--accent-foreground)] transition-opacity duration-[120ms] hover:opacity-90"
						>
							Submit review
							{acceptedThreads.length > 0 ? ` · ${acceptedThreads.length}` : ""}
						</button>
						{submitOpen && details && (
							<SubmitReviewPopover
								prCtx={prCtx}
								headCommitOid={details.headCommitOid}
								acceptedThreads={acceptedThreads}
								pendingCount={pendingCount}
								onClose={() => setSubmitOpen(false)}
								onSubmitted={handleSubmitted}
							/>
						)}
					</div>
				}
			/>
			<div className="flex min-h-0 flex-1">
				{!navigatorCollapsed && (
					<aside
						ref={navRef}
						className="relative shrink-0 overflow-y-auto border-r border-[var(--border)] bg-[var(--bg-surface)]"
						style={{ width: navigatorWidth }}
					>
						{details ? (
							<ReviewNavigator
								workspaceId={workspaceId}
								prCtx={prCtx}
								details={details}
								threads={allThreads}
								commentCountByFile={commentCountByFile}
							/>
						) : (
							<div className="p-4 text-[13px] text-[var(--text-tertiary)]">
								{isLoading ? "Loading review details..." : "Review details unavailable"}
							</div>
						)}
						<div
							role="separator"
							aria-orientation="vertical"
							aria-label="Resize navigator"
							tabIndex={0}
							onPointerDown={startNavigatorResize}
							onKeyDown={(event) => {
								if (event.key === "ArrowLeft") {
									event.preventDefault();
									resizeNavigatorBy(-20);
								}
								if (event.key === "ArrowRight") {
									event.preventDefault();
									resizeNavigatorBy(20);
								}
							}}
							className="absolute right-0 top-0 h-full w-1 cursor-col-resize bg-transparent transition-colors duration-[120ms] hover:bg-[var(--accent)]"
						/>
					</aside>
				)}
				<main
					className={`min-w-0 flex-1 ${view === "changes" ? "overflow-hidden" : "overflow-y-auto"}`}
				>
					{view === "overview" && details ? (
						<OverviewView
							prCtx={prCtx}
							details={details}
							aiDraft={aiDraft}
							counts={counts}
							onJumpToComments={jumpToComments}
						/>
					) : view === "comments" && details ? (
						<CommentsView
							prCtx={prCtx}
							allThreads={allThreads}
							counts={counts}
							fileOrder={fileOrder}
							sessionKey={sessionKey}
							callbacks={callbacks}
						/>
					) : view === "changes" && details ? (
						<ChangesView
							workspaceId={workspaceId}
							prCtx={prCtx}
							details={details}
							allThreads={allThreads}
							fileOrder={fileOrder}
							sessionKey={sessionKey}
							callbacks={callbacks}
						/>
					) : (
						<div className="p-8 text-[13px] text-[var(--text-tertiary)]">
							{isLoading ? "Loading review details..." : "Review details unavailable"}
						</div>
					)}
				</main>
			</div>
			<TerminalDrawer />
		</div>
	);
}
