import { expect, test } from "bun:test";
import {
	type ReviewPathTransport,
	createLiveReviewPathController,
} from "../src/renderer/lib/review-path-source";
import type { ReviewPathIdentity, ReviewPathSnapshot } from "../src/shared/review-path-runtime";
const identity: ReviewPathIdentity = {
	workspaceId: "f4",
	provider: "github",
	owner: "o",
	repo: "r",
	prNumber: 1,
	headSha: "a".repeat(40),
};
const snapshot: ReviewPathSnapshot = {
	identity,
	path: null,
	pathVersion: 0,
	conversationId: "c",
	runs: [],
	questions: [],
	messages: [],
};
function transport(): ReviewPathTransport {
	return {
		get: async () => snapshot,
		start: async () => ({ snapshot }),
		ask: async () => ({ snapshot }),
		cancel: async () => snapshot,
		cancelQuestion: async () => snapshot,
		addContext: async () => snapshot,
		removeContext: async () => snapshot,
	};
}
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}
test("overlapping successful mutations each deliver once without rewinding snapshot or pending state", async () => {
	const t = transport();
	const map = deferred<Awaited<ReturnType<typeof t.start>>>();
	const ask = deferred<Awaited<ReturnType<typeof t.ask>>>();
	t.start = () => map.promise;
	t.ask = () => ask.promise;
	const c = createLiveReviewPathController(identity, t);
	const first = c.start({ id: "codex", label: "Codex" }, false);
	const second = c.ask("q", "why");
	ask.resolve({ snapshot: { ...snapshot, pathVersion: 2 } });
	expect(await second).toBeDefined();
	expect(c.getSnapshot().pending).toBe(true);
	map.resolve({ snapshot: { ...snapshot, pathVersion: 1 } });
	expect(await first).toBeDefined();
	expect(c.getSnapshot().snapshot?.pathVersion).toBe(2);
	expect(c.getSnapshot().pending).toBe(false);
});
test("Ask rejection survives successful polling, is correlated, and clears only on next Ask", async () => {
	const t = transport();
	t.ask = async () => {
		throw Error("question rejected before persistence");
	};
	const c = createLiveReviewPathController(identity, t);
	await c.refresh();
	await c.ask("q1", "keep me");
	await c.refresh();
	expect(c.getSnapshot().mutationErrors?.["ask"]).toEqual({
		id: "q1",
		message: "question rejected before persistence",
	});
	expect(c.getSnapshot().available).toBe(true);
	await c.start({ id: "codex", label: "Codex" }, false);
	expect(c.getSnapshot().mutationErrors?.["ask"]?.id).toBe("q1");
	t.ask = async () => ({ snapshot });
	await c.ask("q2", "retry");
	expect(c.getSnapshot().mutationErrors?.["ask"]).toBeUndefined();
});
