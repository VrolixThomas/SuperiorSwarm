import { expect, test } from "bun:test";
import {
	type ReviewPathTransport,
	createLiveReviewPathController,
} from "../src/renderer/lib/review-path-source";
import type { ReviewPathIdentity, ReviewPathSnapshot } from "../src/shared/review-path-runtime";

const identity: ReviewPathIdentity = {
	workspaceId: "review",
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
function transport(start: ReviewPathTransport["start"]): ReviewPathTransport {
	return {
		get: async () => snapshot,
		start,
		cancel: async () => snapshot,
		ask: async () => ({ snapshot }),
		cancelQuestion: async () => snapshot,
		addContext: async () => snapshot,
		removeContext: async () => snapshot,
	};
}
test("reports preparation immediately while agent start is pending, before a terminal exists", async () => {
	let finish: ((result: { snapshot: ReviewPathSnapshot }) => void) | undefined;
	const controller = createLiveReviewPathController(
		identity,
		transport(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				})
		)
	);
	await controller.refresh();
	const pending = controller.start({ id: "codex", label: "Codex" }, true);
	expect(controller.getSnapshot().starting).toBe(true);
	expect(controller.getSnapshot().snapshot?.runs).toEqual([]);
	finish?.({ snapshot });
	await pending;
	expect(controller.getSnapshot().starting).toBe(false);
	expect(controller.getSnapshot().pending).toBe(false);
});
test("failed preparation clears the preparing state and preserves an actionable error", async () => {
	const controller = createLiveReviewPathController(
		identity,
		transport(async () => {
			throw Error("Review revision fetch timed out");
		})
	);
	await controller.refresh();
	await controller.start({ id: "codex", label: "Codex" }, true);
	expect(controller.getSnapshot().starting).toBe(false);
	expect(controller.getSnapshot().pending).toBe(false);
	expect(controller.getSnapshot().error).toBe("Review revision fetch timed out");
	expect(controller.getSnapshot().snapshot?.runs).toEqual([]);
});
test("an Ask request alone never displays mapping preparation", async () => {
	let finish: ((result: { snapshot: ReviewPathSnapshot }) => void) | undefined;
	const api = transport(async () => ({ snapshot }));
	api.ask = () =>
		new Promise((resolve) => {
			finish = resolve;
		});
	const controller = createLiveReviewPathController(identity, api);
	const pending = controller.ask("question", "Explain this change");
	expect(controller.getSnapshot().starting).toBe(false);
	finish?.({ snapshot });
	await pending;
});
