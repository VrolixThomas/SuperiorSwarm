import {
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { useReviewModeStore } from "../../stores/review-mode-store";
import { AgentStatusChip } from "./AgentStatusChip";
import { ReviewHeader } from "./ReviewHeader";
import { ReviewWorkspace } from "./ReviewWorkspace";
import { SubmitReviewPopover } from "./SubmitReviewPopover";
import { TerminalDrawer, TerminalTab } from "./TerminalDrawer";
import { useReviewKeymap } from "./hooks/useReviewKeymap";
import { ReviewNavigator } from "./navigator/ReviewNavigator";
import { useReviewWorkspaceData } from "./useReviewWorkspaceData";
import { ChangesView } from "./views/ChangesView";
import { CommentsView } from "./views/CommentsView";
import { OverviewView } from "./views/OverviewView";

type ActiveReview = NonNullable<ReturnType<typeof useReviewModeStore.getState>["active"]>;

export function ReviewModeShell() {
	const active = useReviewModeStore((s) => s.active);

	if (!active) return null;

	const { workspaceId, prCtx } = active;
	const reviewIdentity = `${workspaceId}:${prCtx.provider}:${prCtx.owner}/${prCtx.repo}#${prCtx.number}`;
	return <ReviewWorkspace key={reviewIdentity} active={active} />;
}

export function ActiveReviewModeShell({ active }: { active: ActiveReview }) {
	const { workspaceId, prCtx } = active;
	const view = useReviewModeStore((s) => s.view);
	const setView = useReviewModeStore((s) => s.setView);
	const setDrawerOpen = useReviewModeStore((s) => s.setDrawerOpen);
	const navigatorCollapsed = useReviewModeStore((s) => s.navigatorCollapsed);
	const terminal = useReviewModeStore((s) => s.terminals[workspaceId] ?? null);
	const [navigatorWidth, setNavigatorWidth] = useState(280);
	const shellRef = useRef<HTMLDivElement>(null);
	const navRef = useRef<HTMLElement>(null);
	const {
		details,
		isLoading,
		aiDraft,
		allThreads,
		acceptedThreads,
		pendingCount,
		counts,
		sessionKey,
		fileOrder,
		isOpen,
		canSubmitReview,
		commentCount,
		commentCountByFile,
		agentActions,
		callbacks,
		handleClose,
		handleSubmitted,
		submitOpen,
		setSubmitOpen,
		jumpToComments,
	} = useReviewWorkspaceData(workspaceId, prCtx);

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
		readOnly: !isOpen,
		onClose: handleClose,
	});

	return (
		<div
			ref={shellRef}
			tabIndex={-1}
			className="flex h-full min-h-0 min-w-0 flex-col bg-[var(--bg-base)] outline-none"
		>
			<ReviewHeader
				prCtx={prCtx}
				commentCount={commentCount}
				onClose={handleClose}
				terminalAvailable={terminal !== null}
				rightSlot={
					<div
						className="relative flex items-center gap-2"
						onPointerDown={(event) => event.stopPropagation()}
					>
						<AgentStatusChip
							active={agentActions.isReviewActive}
							startedAt={agentActions.startedAt}
							canceling={agentActions.isPending}
							onOpen={() => {
								if (view === "terminal") setView("changes");
								setDrawerOpen(true);
							}}
							onCancel={agentActions.cancel}
						/>
						<button
							type="button"
							disabled={!isOpen || agentActions.isPending}
							onClick={() => void agentActions.trigger()}
							className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-3 py-1.5 text-[12px] font-medium text-[var(--text-secondary)] transition-colors duration-[120ms] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-50"
						>
							{!isOpen
								? "Review closed"
								: agentActions.isPending
									? "Starting..."
									: agentActions.label}
						</button>
						<button
							type="button"
							disabled={!canSubmitReview}
							title={!isOpen ? "Closed and merged pull requests are read-only" : undefined}
							onClick={() => setSubmitOpen((open) => !open)}
							className="rounded-[var(--radius-sm)] bg-[var(--accent)] px-3 py-1.5 text-[12px] font-semibold text-[var(--accent-foreground)] transition-opacity duration-[120ms] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
						>
							Submit review
							{acceptedThreads.length > 0 ? ` · ${acceptedThreads.length}` : ""}
						</button>
						{submitOpen && details && canSubmitReview && (
							<SubmitReviewPopover
								prCtx={prCtx}
								draftId={aiDraft?.id ?? null}
								acceptedThreads={acceptedThreads}
								pendingCount={pendingCount}
								onClose={() => setSubmitOpen(false)}
								onSubmitted={handleSubmitted}
							/>
						)}
					</div>
				}
			/>
			{details && !isOpen && (
				<div className="shrink-0 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4 py-2 text-[12px] text-[var(--text-secondary)]">
					This pull request is {details.state.toLowerCase()} and is available in read-only mode.
				</div>
			)}
			<div className="flex min-h-0 flex-1">
				{view !== "terminal" && !navigatorCollapsed && (
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
					className={`min-w-0 flex-1 ${
						view === "changes" || view === "terminal" ? "overflow-hidden" : "overflow-y-auto"
					}`}
				>
					{view === "terminal" ? (
						<TerminalTab />
					) : view === "overview" && details ? (
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
							readOnly={!isOpen}
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
