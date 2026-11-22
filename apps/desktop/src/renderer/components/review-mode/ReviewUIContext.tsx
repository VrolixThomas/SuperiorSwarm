import {
	type Dispatch,
	type ReactNode,
	type SetStateAction,
	createContext,
	useCallback,
	useContext,
	useState,
} from "react";
import { useStore } from "zustand";
import type { PRContext } from "../../../shared/github-types";
import { usePRReviewSessionStore } from "../../stores/pr-review-session-store";
import {
	type ReviewModeStore,
	createReviewModeStore,
	reviewSessionIdentity,
	useReviewModeStore,
} from "../../stores/review-mode-store";

export function reviewUIScopeKey({
	workspaceId,
	prCtx,
}: { workspaceId: string; prCtx: PRContext }) {
	return `${workspaceId}::${prCtx.provider}:${prCtx.owner}/${prCtx.repo}#${prCtx.number}`;
}
const scopes = new Map<string, ReturnType<typeof createReviewModeStore>>();
export function reviewUIStoreFor(key: string) {
	let store = scopes.get(key);
	if (!store) {
		store = createReviewModeStore();
		scopes.set(key, store);
	}
	return store;
}
type ReviewOwner = { workspaceId: string; prCtx: PRContext };
const ReviewUIContext = createContext<{
	key: string | null;
	active: boolean;
	compact: boolean;
	review: ReviewOwner | null;
}>({
	key: null,
	active: true,
	compact: false,
	review: null,
});
export function ReviewUIProvider({
	scopeKey,
	review = null,
	active = true,
	compact = false,
	children,
}: {
	scopeKey: string | null;
	review?: ReviewOwner | null;
	active?: boolean;
	compact?: boolean;
	children: ReactNode;
}) {
	return (
		<ReviewUIContext.Provider value={{ key: scopeKey, review, active, compact }}>
			{children}
		</ReviewUIContext.Provider>
	);
}
export function useReviewUI() {
	return useContext(ReviewUIContext);
}
/** Queue origin is durable navigation state, independent of which PR pane is focused. */
export function useReviewQueueOrigin() {
	const { review } = useReviewUI();
	return useReviewModeStore((state) =>
		review
			? (state.queueOrigins[reviewSessionIdentity(review.workspaceId, review.prCtx)] ?? null)
			: state.queueOrigin
	);
}
export function useReviewUIApi() {
	const { key } = useReviewUI();
	return key ? reviewUIStoreFor(key) : useReviewModeStore;
}
export function useReviewUIStore<T>(selector: (state: ReviewModeStore) => T) {
	return useStore(useReviewUIApi(), selector);
}
/** Session-backed drafts survive moving a tab to a different pane parent. */
export function useReviewDraft<T>(name: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
	const { key } = useReviewUI();
	const [local, setLocal] = useState(initial);
	const saved = usePRReviewSessionStore((s) =>
		key ? s.sessions.get(key)?.drafts?.[name] : undefined
	);
	const value = saved === undefined ? (key ? initial : local) : (saved as T);
	const setValue = useCallback<Dispatch<SetStateAction<T>>>(
		(next) => {
			if (!key) {
				setLocal(next);
				return;
			}
			const store = usePRReviewSessionStore.getState();
			const previous = store.sessions.get(key)?.drafts?.[name] as T | undefined;
			store.setDraft(
				key,
				name,
				typeof next === "function"
					? (next as (value: T) => T)(previous === undefined ? initial : previous)
					: next
			);
		},
		[key, name, initial]
	);
	return [value, setValue];
}
