interface PRReviewEventMap {
	"toggle-viewed": undefined;
	"new-comment": undefined;
	"focus-reply": { threadId: string };
	"edit-thread": { draftCommentId: string | null };
}

type EventName = keyof PRReviewEventMap;

const channel = (name: EventName) => `pr-review:${name}`;

export function emitPRReviewEvent<K extends EventName>(
	name: K,
	...args: PRReviewEventMap[K] extends undefined ? [] : [PRReviewEventMap[K]]
): void {
	const detail = args[0];
	window.dispatchEvent(new CustomEvent(channel(name), detail !== undefined ? { detail } : {}));
}

export function subscribePRReviewEvent<K extends EventName>(
	name: K,
	handler: (detail: PRReviewEventMap[K]) => void
): () => void {
	const wrapped = (e: Event) => handler((e as CustomEvent<PRReviewEventMap[K]>).detail);
	window.addEventListener(channel(name), wrapped);
	return () => window.removeEventListener(channel(name), wrapped);
}
