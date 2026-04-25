import { beforeEach, describe, expect, test } from "bun:test";
import {
	prReviewSessionKey,
	usePRReviewSessionStore,
} from "../src/renderer/stores/pr-review-session-store";

const key = prReviewSessionKey("ws1", "owner/repo#42");

function reset() {
	usePRReviewSessionStore.setState({ sessions: new Map() });
}

describe("pr-review-session-store lifecycle", () => {
	beforeEach(reset);

	test("session is created lazily on first write", () => {
		usePRReviewSessionStore.getState().selectFile(key, "a.ts");
		const s = usePRReviewSessionStore.getState().sessions.get(key);
		expect(s).toBeDefined();
		expect(s!.activeFilePath).toBe("a.ts");
		expect(s!.activeThreadId).toBeNull();
		expect(s!.fileOrder).toEqual([]);
		expect(s!.threadOrder).toEqual([]);
	});

	test("sessions are isolated per key", () => {
		const k2 = prReviewSessionKey("ws2", "owner/repo#42");
		usePRReviewSessionStore.getState().selectFile(key, "a.ts");
		usePRReviewSessionStore.getState().selectFile(k2, "z.ts");
		expect(usePRReviewSessionStore.getState().sessions.get(key)!.activeFilePath).toBe("a.ts");
		expect(usePRReviewSessionStore.getState().sessions.get(k2)!.activeFilePath).toBe("z.ts");
	});

	test("selectFile to null clears the value", () => {
		usePRReviewSessionStore.getState().selectFile(key, "a.ts");
		usePRReviewSessionStore.getState().selectFile(key, null);
		expect(usePRReviewSessionStore.getState().sessions.get(key)!.activeFilePath).toBeNull();
	});
});
