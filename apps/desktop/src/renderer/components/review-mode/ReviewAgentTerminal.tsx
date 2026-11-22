import { revealReview } from "../../lib/review-agent-jobs";
import { useReviewModeStore } from "../../stores/review-mode-store";
import { trpc } from "../../trpc/client";
import { Terminal } from "../Terminal";

/** A saved tab identifies a run, but is never proof that its PTY still exists. */
export function ReviewAgentTerminal({
	id,
	workspaceId,
	cwd,
	initialContent,
	active,
}: {
	id: string;
	workspaceId: string;
	cwd: string;
	initialContent?: string;
	active: boolean;
}) {
	const review = useReviewModeStore((state) => state.active);
	const state = trpc.reviewPath.terminalState.useQuery(
		{ workspaceId, terminalId: id },
		{
			enabled: active,
			staleTime: 2000,
			refetchInterval: (query) =>
				active && query.state.data?.status === "available" ? 3000 : false,
		}
	);
	if (state.data?.status === "available" && !state.isError) {
		return (
			<Terminal
				id={id}
				workspaceId={workspaceId}
				cwd={state.data.cwd ?? cwd}
				initialContent={initialContent}
				active={active}
			/>
		);
	}
	const ended = state.data?.status === "ended";
	const title = state.isPending
		? "Checking agent session…"
		: ended
			? state.data?.runState === "completed"
				? "Agent finished"
				: "Agent session ended"
			: "Agent session unavailable";
	return (
		<section
			className="flex h-full items-center justify-center p-8"
			aria-label="Agent session status"
		>
			<div className="w-full max-w-[480px] rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-6">
				<h2 className="text-[16px] font-semibold text-[var(--text)]">{title}</h2>
				{!state.isPending && (
					<p className="mt-2 text-[13px] leading-5 text-[var(--text-secondary)]">
						{state.isError
							? "Could not check this session. Try checking again."
							: (state.data?.message ??
								"This session is not available. Return to the PR to check the agent's result.")}
					</p>
				)}
				<div className="mt-4 flex gap-3">
					{review?.workspaceId === workspaceId && (
						<button
							type="button"
							onClick={() => {
								useReviewModeStore.getState().setQueueOpen(false);
								revealReview(workspaceId);
							}}
							className="rounded-md bg-[var(--accent)] px-3 py-2 text-[12px] font-medium text-[var(--accent-foreground)]"
						>
							Open reading path
						</button>
					)}
					{!ended && !state.isPending && (
						<button
							type="button"
							onClick={() => void state.refetch()}
							className="rounded-md border border-[var(--border)] px-3 py-2 text-[12px] text-[var(--text-secondary)]"
						>
							Check session again
						</button>
					)}
				</div>
			</div>
		</section>
	);
}
