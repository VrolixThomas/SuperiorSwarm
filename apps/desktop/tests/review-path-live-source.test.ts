import { expect, test } from "bun:test";
import {
	type ReviewPathTransport,
	createLiveReviewPathController,
	reviewPathIdentityKey,
} from "../src/renderer/lib/review-path-source";
import type { ReviewPathIdentity, ReviewPathSnapshot } from "../src/shared/review-path-runtime";
const identity: ReviewPathIdentity = {
	workspaceId: "w",
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
function transport(get: ReviewPathTransport["get"]): ReviewPathTransport {
	return {
		get,
		start: async () => ({ snapshot: { ...snapshot, pathVersion: 1 } }),
		cancel: async () => snapshot,
		ask: async () => ({ snapshot }),
		cancelQuestion: async () => snapshot,
		addContext: async () => snapshot,
		removeContext: async () => snapshot,
	};
}
test("late poll does not replace a newer mapping mutation", async () => {
	let release!: (value: ReviewPathSnapshot) => void;
	const c = createLiveReviewPathController(
		identity,
		transport(
			() =>
				new Promise((resolve) => {
					release = resolve;
				})
		)
	);
	const old = c.refresh();
	await c.start({ id: "codex", label: "Codex" }, false);
	release(snapshot);
	await old;
	expect(c.getSnapshot().snapshot?.pathVersion).toBe(1);
});
test("backend failure preserves partial path and never manufactures answers", async () => {
	let offline = false;
	const c = createLiveReviewPathController(
		identity,
		transport(async () => {
			if (offline) throw Error("offline");
			return snapshot;
		})
	);
	await c.refresh();
	offline = true;
	await c.refresh();
	expect(c.getSnapshot()).toMatchObject({ available: false, error: "offline", snapshot });
	expect(c.getSnapshot().snapshot?.messages).toEqual([]);
});
test("workspace and head identity fence response data", async () => {
	const c = createLiveReviewPathController(
		identity,
		transport(async () => ({ ...snapshot, identity: { ...identity, headSha: "b".repeat(40) } }))
	);
	await c.refresh();
	expect(c.getSnapshot().snapshot).toBeNull();
	expect(c.getSnapshot().error).toContain("identity mismatch");
	expect(reviewPathIdentityKey(identity)).not.toBe(
		reviewPathIdentityKey({ ...identity, workspaceId: "other" })
	);
});
