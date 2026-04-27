interface SolveReviewEventMap {
	"select-file": { delta: 1 | -1 };
	"select-group": { delta: 1 | -1 };
	"next-comment": { delta: 1 | -1 };
	"toggle-group": undefined;
	"toggle-sidebar": undefined;
	"approve-current-group": undefined;
	"revoke-current-group": undefined;
	"push-current-group": undefined;
	"open-follow-up": undefined;
	"clear-active": undefined;
}

type EventName = keyof SolveReviewEventMap;

const channel = (name: EventName) => `solve-review:${name}`;

export function emitSolveReviewEvent<K extends EventName>(
	name: K,
	...args: SolveReviewEventMap[K] extends undefined ? [] : [SolveReviewEventMap[K]]
): void {
	const detail = args[0];
	window.dispatchEvent(new CustomEvent(channel(name), detail !== undefined ? { detail } : {}));
}

export function subscribeSolveReviewEvent<K extends EventName>(
	name: K,
	handler: (detail: SolveReviewEventMap[K]) => void
): () => void {
	const wrapped = (e: Event) => handler((e as CustomEvent<SolveReviewEventMap[K]>).detail);
	window.addEventListener(channel(name), wrapped);
	return () => window.removeEventListener(channel(name), wrapped);
}
