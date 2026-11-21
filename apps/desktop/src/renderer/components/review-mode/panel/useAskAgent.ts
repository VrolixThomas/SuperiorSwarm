/** Stable Ask boundary. Fixture mode is explicit; live requests never receive sample answers. */
import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { PRContext } from "../../../../shared/github-types";
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
	const live = useLiveReviewPath(options.fixture ? undefined : options.identity);
	const fixture = options.fixture === true;
	const key = reviewPathRegistryKey(prCtx, fixture);
	const snapshot = useCallback(() => conversations.get(key) ?? empty, [key]);
	const messages = useSyncExternalStore(subscribe, snapshot, snapshot);
	const send = useCallback(
		(text: string, anchor?: AskMessage["anchor"]) => {
			if (!text.trim()) return;
			if (!fixture) {
				void live.controller?.ask(crypto.randomUUID(), text, anchor).then((result) => {
					if (result?.launch && live.isCurrent()) options.onLaunch?.(result.launch);
				});
				return;
			}
			const createdAt = new Date().toISOString();
			const id = crypto.randomUUID();
			const sample = PR129_ASK_SAMPLE.find((message) => message.role === "agent");
			if (!sample) return;
			const answer: AskMessage = { ...sample, id: `${id}:answer`, createdAt };
			conversations.set(key, [
				...snapshot(),
				{ id, role: "user", text, anchor, createdAt },
				answer,
			]);
			for (const listener of listeners) listener();
		},
		[key, fixture, snapshot, live.controller, live.isCurrent, options.onLaunch]
	);
	const conversation = useMemo(
		() => selectAskConversation(live.state.snapshot),
		[live.state.snapshot]
	);
	return {
		messages: fixture ? messages : conversation.messages,
		send,
		status: fixture
			? ("idle" as const)
			: live.state.error || conversation.error
				? ("error" as const)
				: conversation.pending || live.state.pending
					? ("pending" as const)
					: live.state.available
						? ("idle" as const)
						: ("unavailable" as const),
		available: fixture || live.state.available,
		error: fixture ? undefined : (live.state.error ?? conversation.error),
		questions: conversation.questions,
		cancel: (questionId: string) => {
			void live.controller?.cancelQuestion(questionId);
		},
	};
}
