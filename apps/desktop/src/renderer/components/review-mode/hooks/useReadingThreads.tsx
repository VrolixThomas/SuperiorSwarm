import { useCallback, useMemo } from "react";
import type { UnifiedThread } from "../../../../shared/github-types";
import type { CodeReference } from "../../../../shared/review-path-types";
import type { ReviewPathSource } from "../../../lib/review-path-source";
import { usePRReviewSessionStore } from "../../../stores/pr-review-session-store";
import { useReviewModeStore } from "../../../stores/review-mode-store";
import { AgentNoteRow } from "../thread/AgentNoteRow";
import { FindingCard } from "../thread/FindingCard";
import { ResolvedThreadRow } from "../thread/ResolvedThreadRow";
import { ThreadCard } from "../thread/ThreadCard";
import type { useReviewWorkspaceData } from "../useReviewWorkspaceData";
import type { useReadingNavigation } from "./useReadingNavigation";
export function useReadingThreads(
	data: ReturnType<typeof useReviewWorkspaceData>,
	nav: ReturnType<typeof useReadingNavigation>,
	source: ReviewPathSource,
	onReference: (ref: CodeReference) => void
) {
	const activeThreadId = usePRReviewSessionStore(
		(s) => s.sessions.get(data.sessionKey)?.activeThreadId ?? null
	);
	const openThread = useCallback(
		(thread: UnifiedThread) => {
			nav.openReference({
				path: thread.path,
				line: thread.isAIDraft || !thread.isOutdated ? (thread.line ?? 1) : 1,
				description: "Review thread",
			});
			usePRReviewSessionStore.getState().selectThread(data.sessionKey, thread.id);
		},
		[nav.openReference, data.sessionKey]
	);
	const callbacks = useMemo(
		() => ({
			...data.callbacks,
			onOpenInChanges: (path: string, threadId: string) => {
				const thread = data.allThreads.find((thread) => thread.id === threadId);
				if (thread) openThread(thread);
				else nav.openReference({ path, line: 1, description: "Review file" });
			},
			onOpenInComments: () => useReviewModeStore.getState().setPanel("threads"),
		}),
		[data.callbacks, data.allThreads, openThread, nav.openReference]
	);
	const renderThread = useCallback(
		(thread: UnifiedThread) => {
			const onAsk = () =>
				nav.ask(
					{
						path: thread.path,
						side: thread.diffSide,
						startLine: thread.line ?? 1,
						endLine: thread.line ?? 1,
					},
					`Explain this review comment: ${thread.isAIDraft ? thread.body : (thread.comments[0]?.body ?? "")}`
				);
			if (thread.isAIDraft && thread.status === "pending") {
				const findings = data.allThreads.filter(
					(candidate) =>
						candidate.isAIDraft && candidate.status === "pending" && candidate.path === thread.path
				);
				return (
					<FindingCard
						thread={thread}
						callbacks={callbacks}
						agentLabel={source.path?.agent.label}
						index={findings.findIndex((candidate) => candidate.id === thread.id) + 1}
						total={findings.length}
						onAsk={onAsk}
					/>
				);
			}
			if (!thread.isAIDraft && thread.isResolved)
				return (
					<ResolvedThreadRow
						thread={thread}
						callbacks={callbacks}
						active={thread.id === activeThreadId}
					/>
				);
			const note = source.path?.threadNotes?.[thread.id];
			return (
				<ThreadCard
					thread={thread}
					variant="inline"
					callbacks={callbacks}
					active={thread.id === activeThreadId}
					onAsk={onAsk}
					agentNote={note ? <AgentNoteRow note={note} onReference={onReference} /> : undefined}
				/>
			);
		},
		[nav.ask, data.allThreads, callbacks, source.path, activeThreadId, onReference]
	);
	return { openThread, callbacks, renderThread };
}
