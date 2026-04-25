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

describe("pr-review-session-store file navigation", () => {
	beforeEach(reset);

	test("advanceFile no-ops when fileOrder is empty", () => {
		usePRReviewSessionStore.getState().advanceFile(key, 1);
		const s = usePRReviewSessionStore.getState().sessions.get(key);
		expect(s?.activeFilePath ?? null).toBeNull();
	});

	test("advanceFile selects first file when activeFilePath is null", () => {
		usePRReviewSessionStore.getState().setFileOrder(key, ["a.ts", "b.ts", "c.ts"]);
		usePRReviewSessionStore.getState().advanceFile(key, 1);
		expect(usePRReviewSessionStore.getState().sessions.get(key)!.activeFilePath).toBe("a.ts");
	});

	test("advanceFile +1 moves to the next file", () => {
		const store = usePRReviewSessionStore.getState();
		store.setFileOrder(key, ["a.ts", "b.ts", "c.ts"]);
		store.selectFile(key, "a.ts");
		store.advanceFile(key, 1);
		expect(usePRReviewSessionStore.getState().sessions.get(key)!.activeFilePath).toBe("b.ts");
	});

	test("advanceFile +1 stops at last file (no wrap)", () => {
		const store = usePRReviewSessionStore.getState();
		store.setFileOrder(key, ["a.ts", "b.ts"]);
		store.selectFile(key, "b.ts");
		store.advanceFile(key, 1);
		expect(usePRReviewSessionStore.getState().sessions.get(key)!.activeFilePath).toBe("b.ts");
	});

	test("advanceFile -1 stops at first file", () => {
		const store = usePRReviewSessionStore.getState();
		store.setFileOrder(key, ["a.ts", "b.ts"]);
		store.selectFile(key, "a.ts");
		store.advanceFile(key, -1);
		expect(usePRReviewSessionStore.getState().sessions.get(key)!.activeFilePath).toBe("a.ts");
	});

	test("setFileOrder clamps activeFilePath if it disappears", () => {
		const store = usePRReviewSessionStore.getState();
		store.setFileOrder(key, ["a.ts", "b.ts"]);
		store.selectFile(key, "b.ts");
		store.setFileOrder(key, ["a.ts", "c.ts"]);
		expect(usePRReviewSessionStore.getState().sessions.get(key)!.activeFilePath).toBe("a.ts");
	});
});

describe("pr-review-session-store thread navigation", () => {
	beforeEach(reset);

	test("advanceThread no-ops when threadOrder is empty", () => {
		usePRReviewSessionStore.getState().advanceThread(key, 1);
		expect(usePRReviewSessionStore.getState().sessions.get(key)?.activeThreadId ?? null).toBeNull();
	});

	test("advanceThread selects first thread when activeThreadId is null", () => {
		const store = usePRReviewSessionStore.getState();
		store.setThreadOrder(key, ["t1", "t2", "t3"]);
		store.advanceThread(key, 1);
		expect(usePRReviewSessionStore.getState().sessions.get(key)!.activeThreadId).toBe("t1");
	});

	test("advanceThread +1 moves to next, stops at end", () => {
		const store = usePRReviewSessionStore.getState();
		store.setThreadOrder(key, ["t1", "t2"]);
		store.selectThread(key, "t1");
		store.advanceThread(key, 1);
		expect(usePRReviewSessionStore.getState().sessions.get(key)!.activeThreadId).toBe("t2");
		store.advanceThread(key, 1);
		expect(usePRReviewSessionStore.getState().sessions.get(key)!.activeThreadId).toBe("t2");
	});

	test("advanceThread -1 stops at first", () => {
		const store = usePRReviewSessionStore.getState();
		store.setThreadOrder(key, ["t1", "t2"]);
		store.selectThread(key, "t1");
		store.advanceThread(key, -1);
		expect(usePRReviewSessionStore.getState().sessions.get(key)!.activeThreadId).toBe("t1");
	});

	test("setThreadOrder clears stale activeThreadId", () => {
		const store = usePRReviewSessionStore.getState();
		store.setThreadOrder(key, ["t1", "t2"]);
		store.selectThread(key, "t2");
		store.setThreadOrder(key, ["t1", "t3"]);
		expect(usePRReviewSessionStore.getState().sessions.get(key)!.activeThreadId).toBeNull();
	});
});
