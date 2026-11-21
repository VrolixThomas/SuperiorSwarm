/** Stable Ask boundary. Fixture mode is explicit; live requests never receive sample answers. */
import { useCallback, useSyncExternalStore } from "react";
import type { PRContext } from "../../../../shared/github-types";
import type {
	ReviewPathIdentity,
	ReviewPathLaunchResult,
} from "../../../../shared/review-path-runtime";
import type { AskMessage } from "../../../../shared/review-path-types";
import { PR129_ASK_SAMPLE } from "../../../lib/review-path-fixtures";
import { reviewPathRegistryKey, useLiveReviewPath } from "../../../lib/review-path-source";

const conversations = new Map<string, AskMessage[]>();
const listeners = new Set<() => void>();
const empty: AskMessage[] = [];
const subscribe = (listener: () => void) => {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
};

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
					if (result?.launch) options.onLaunch?.(result.launch);
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
		[key, fixture, snapshot, live.controller, options.onLaunch]
	);
	const pending =
		live.state.snapshot?.questions.some((question) => question.state === "pending") ?? false;
	const questionError = live.state.snapshot?.questions.find(
		(question) => question.state === "failed"
	)?.error;
	return {
		messages: fixture ? messages : (live.state.snapshot?.messages ?? empty),
		send,
		status: fixture
			? ("idle" as const)
			: live.state.error || questionError
				? ("error" as const)
				: pending || live.state.pending
					? ("pending" as const)
					: live.state.available
						? ("idle" as const)
						: ("unavailable" as const),
		available: fixture || live.state.available,
		error: fixture ? undefined : (live.state.error ?? questionError),
		questions: live.state.snapshot?.questions ?? [],
		cancel: (questionId: string) => {
			void live.controller?.cancelQuestion(questionId);
		},
	};
}
