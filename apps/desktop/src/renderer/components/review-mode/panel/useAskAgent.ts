/** Stable Ask boundary. Fixture mode is explicit; live requests never receive sample answers. */
import { useCallback, useSyncExternalStore } from "react";
import type { PRContext } from "../../../../shared/github-types";
import type { AskMessage } from "../../../../shared/review-path-types";
import { PR129_ASK_SAMPLE } from "../../../lib/review-path-fixtures";
import { reviewPathRegistryKey } from "../../../lib/review-path-source";

const conversations = new Map<string, AskMessage[]>();
const listeners = new Set<() => void>();
const empty: AskMessage[] = [];
const subscribe = (listener: () => void) => {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
};

export function useAskAgent(prCtx: PRContext, options: { fixture?: boolean } = {}) {
	const fixture = options.fixture === true;
	const key = reviewPathRegistryKey(prCtx, fixture);
	const snapshot = useCallback(() => conversations.get(key) ?? empty, [key]);
	const messages = useSyncExternalStore(subscribe, snapshot, snapshot);
	const send = useCallback(
		(text: string, anchor?: AskMessage["anchor"]) => {
			if (!text.trim()) return;
			const createdAt = new Date().toISOString();
			const id = crypto.randomUUID();
			const sample = PR129_ASK_SAMPLE.find((message) => message.role === "agent");
			const answer: AskMessage =
				fixture && sample
					? { ...sample, id: `${id}:answer`, createdAt }
					: { id: `${id}:answer`, role: "agent", text: "Agent not connected yet.", createdAt };
			conversations.set(key, [
				...snapshot(),
				{ id, role: "user", text, anchor, createdAt },
				answer,
			]);
			for (const listener of listeners) listener();
		},
		[key, fixture, snapshot]
	);
	return {
		messages,
		send,
		status: fixture ? ("idle" as const) : ("unavailable" as const),
		available: fixture,
	};
}
