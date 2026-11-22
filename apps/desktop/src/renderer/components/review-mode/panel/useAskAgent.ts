/** Stable Ask boundary. Fixture mode is explicit; live requests never receive sample answers. */
import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { PRContext } from "../../../../shared/github-types";
import { isReviewAgentJobActive, reviewAgentQuestionId } from "../../../../shared/review-agent-job";
import type {
	ReviewPathIdentity,
	ReviewPathLaunchResult,
	ReviewPathSnapshot,
} from "../../../../shared/review-path-runtime";
import type { AskMessage } from "../../../../shared/review-path-types";
import { PR129_ASK_SAMPLE } from "../../../lib/review-path-fixtures";
import {
	reviewPathIdentityKey,
	reviewPathRegistryKey,
	useLiveReviewPath,
} from "../../../lib/review-path-source";
import { trpcVanilla } from "../../../trpc/client";
import { useReviewAgentJobs } from "../useReviewAgentJob";

const conversations = new Map<string, AskMessage[]>();
const listeners = new Set<() => void>();
const empty: AskMessage[] = [];
const subscribe = (listener: () => void) => {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
};

export function selectAskConversation(snapshot: ReviewPathSnapshot | null) {
	const questions =
		snapshot?.questions.filter(
			(question) =>
				question.conversationId === snapshot.conversationId &&
				snapshot.runs.some(
					(run) =>
						run.id === question.runId &&
						run.questionId === question.id &&
						run.conversationId === snapshot.conversationId &&
						reviewPathIdentityKey(run.identity) === reviewPathIdentityKey(snapshot.identity)
				)
		) ?? [];
	const selected = new Map<string, AskMessage>();
	for (const question of questions) {
		selected.set(question.message.id, question.message);
		if (question.answer)
			selected.set(question.answer.id, { ...question.answer, anchor: question.message.anchor });
	}
	const messages =
		snapshot?.messages.flatMap((message) => {
			const selectedMessage = selected.get(message.id);
			return selectedMessage ? [selectedMessage] : [];
		}) ?? [];
	const latest = questions.at(-1);
	return {
		questions,
		messages,
		pending: questions.some((question) => question.state === "pending"),
		error: latest?.state === "failed" ? latest.error : undefined,
	};
}

export function useAskAgent(
	prCtx: PRContext,
	options: {
		fixture?: boolean;
		identity?: ReviewPathIdentity;
		onLaunch?: (launch: ReviewPathLaunchResult) => void;
	} = {}
) {
	const [cancelError, setCancelError] = useState<string>();
	const live = useLiveReviewPath(options.fixture ? undefined : options.identity);
	const fixture = options.fixture === true;
	const jobs = useReviewAgentJobs(
		options.identity?.workspaceId ?? "",
		!fixture && !!options.identity
	);
	const questionJobs =
		jobs.data?.filter(
			(job) => job.kind === "question" && job.identity.headSha === options.identity?.headSha
		) ?? [];
	const activeQuestionJobs = questionJobs.filter(isReviewAgentJobActive);
	const latestJob = questionJobs.at(-1);
	const key = reviewPathRegistryKey(prCtx, fixture);
	const snapshot = useCallback(() => conversations.get(key) ?? empty, [key]);
	const messages = useSyncExternalStore(subscribe, snapshot, snapshot);
	const sending = useRef(new Set<typeof live.controller>());
	const unacknowledged = useRef(
		new Map<typeof live.controller, { id: string; signature: string }>()
	);
	const send = useCallback(
		async (text: string, anchor?: AskMessage["anchor"]): Promise<boolean> => {
			if (!text.trim() || sending.current.has(live.controller)) return false;
			if (!fixture) {
				sending.current.add(live.controller);
				try {
					const signature = JSON.stringify([text, anchor, live.state.snapshot?.conversationId]);
					let request = unacknowledged.current.get(live.controller);
					if (!request || request.signature !== signature) {
						request = { id: crypto.randomUUID(), signature };
						unacknowledged.current.set(live.controller, request);
					}
					const result = await live.controller?.ask(request.id, text, anchor);
					if (result) unacknowledged.current.delete(live.controller);
					if (!live.isCurrent()) return false;
					if (result?.launch) options.onLaunch?.(result.launch);
					return !!result;
				} finally {
					sending.current.delete(live.controller);
				}
			}
			const createdAt = new Date().toISOString();
			const id = crypto.randomUUID();
			const sample = PR129_ASK_SAMPLE.find((message) => message.role === "agent");
			if (!sample) return false;
			const answer: AskMessage = { ...sample, id: `${id}:answer`, createdAt };
			conversations.set(key, [
				...snapshot(),
				{ id, role: "user", text, anchor, createdAt },
				answer,
			]);
			for (const listener of listeners) listener();
			return true;
		},
		[
			key,
			fixture,
			snapshot,
			live.controller,
			live.isCurrent,
			live.state.snapshot?.conversationId,
			options.onLaunch,
		]
	);
	const conversation = useMemo(
		() => selectAskConversation(live.state.snapshot),
		[live.state.snapshot]
	);
	const error =
		cancelError ??
		(activeQuestionJobs.length ? undefined : live.state.mutationErrors?.["ask"]?.message) ??
		live.state.mutationErrors?.["cancelQuestion"]?.message ??
		(live.controller ? live.state.pollError : live.state.error) ??
		(activeQuestionJobs.length ? undefined : conversation.error) ??
		(latestJob?.state === "failed" ? latestJob.error : undefined);
	return {
		messages: fixture
			? messages
			: [
					...conversation.messages,
					...activeQuestionJobs.flatMap((job) =>
						job.question &&
						!conversation.messages.some((message) => message.id === reviewAgentQuestionId(job))
							? [
									{
										id: reviewAgentQuestionId(job),
										role: "user" as const,
										text: job.question.text,
										anchor: job.question.anchor,
										createdAt: job.startedAt ?? "",
									},
								]
							: []
					),
				],
		send,
		status: fixture
			? ("idle" as const)
			: error
				? ("error" as const)
				: conversation.pending || live.state.pending || activeQuestionJobs.length > 0
					? ("pending" as const)
					: live.state.available
						? ("idle" as const)
						: ("unavailable" as const),
		available: fixture || live.state.available,
		error: fixture ? undefined : error,
		questions: [
			...conversation.questions,
			...activeQuestionJobs.flatMap((job) =>
				job.question &&
				!conversation.questions.some((question) => question.id === reviewAgentQuestionId(job))
					? [
							{
								id: reviewAgentQuestionId(job),
								conversationId: live.state.snapshot?.conversationId ?? job.id,
								runId: job.runId ?? job.id,
								state: "pending" as const,
								message: {
									id: reviewAgentQuestionId(job),
									role: "user" as const,
									text: job.question.text,
									anchor: job.question.anchor,
									createdAt: job.startedAt ?? "",
								},
							},
						]
					: []
			),
		],
		cancel: (questionId: string) => {
			setCancelError(undefined);
			const job = activeQuestionJobs.find((job) => reviewAgentQuestionId(job) === questionId);
			if (job)
				void trpcVanilla.reviewPath.cancelJob
					.mutate({ workspaceId: job.identity.workspaceId, jobId: job.id })
					.then(() => jobs.refetch())
					.catch((error) => setCancelError(error instanceof Error ? error.message : String(error)));
			else void live.controller?.cancelQuestion(questionId);
		},
	};
}
