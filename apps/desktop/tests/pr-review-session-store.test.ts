import { beforeEach, describe, expect, test } from "bun:test";
import {
	prReviewSessionKey,
	usePRReviewSessionStore,
} from "../src/renderer/stores/pr-review-session-store";

const key = prReviewSessionKey("ws1", "owner/repo#42");

function reset() {
	usePRReviewSessionStore.setState({ sessions: new Map() });
}

function sessionFor(sessionKey = key) {
	const session = usePRReviewSessionStore.getState().sessions.get(sessionKey);
	if (!session) throw new Error(`missing PR review session for ${sessionKey}`);
	return session;
}

describe("pr-review-session-store lifecycle", () => {
	beforeEach(reset);

	test("session is created lazily on first write", () => {
		usePRReviewSessionStore.getState().selectFile(key, "a.ts");
		const s = sessionFor();
		expect(s.activeFilePath).toBe("a.ts");
		expect(s.activeThreadId).toBeNull();
		expect(s.fileOrder).toEqual([]);
		expect(s.threadOrder).toEqual([]);
	});

	test("sessions are isolated per key", () => {
		const k2 = prReviewSessionKey("ws2", "owner/repo#42");
		usePRReviewSessionStore.getState().selectFile(key, "a.ts");
		usePRReviewSessionStore.getState().selectFile(k2, "z.ts");
		expect(sessionFor(key).activeFilePath).toBe("a.ts");
		expect(sessionFor(k2).activeFilePath).toBe("z.ts");
	});

	test("selectFile to null clears the value", () => {
		usePRReviewSessionStore.getState().selectFile(key, "a.ts");
		usePRReviewSessionStore.getState().selectFile(key, null);
		expect(sessionFor().activeFilePath).toBeNull();
	});

	test("selectFile clears activeThreadId when the file changes", () => {
		const store = usePRReviewSessionStore.getState();
		store.selectFile(key, "a.ts");
		store.selectThread(key, "thread-a");
		store.selectFile(key, "b.ts");

		const session = sessionFor();
		expect(session.activeFilePath).toBe("b.ts");
		expect(session.activeThreadId).toBeNull();
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
		expect(sessionFor().activeFilePath).toBe("a.ts");
	});

	test("advanceFile +1 moves to the next file", () => {
		const store = usePRReviewSessionStore.getState();
		store.setFileOrder(key, ["a.ts", "b.ts", "c.ts"]);
		store.selectFile(key, "a.ts");
		store.selectThread(key, "thread-a");
		store.advanceFile(key, 1);
		const session = sessionFor();
		expect(session.activeFilePath).toBe("b.ts");
		expect(session.activeThreadId).toBeNull();
	});

	test("advanceFile +1 stops at last file (no wrap)", () => {
		const store = usePRReviewSessionStore.getState();
		store.setFileOrder(key, ["a.ts", "b.ts"]);
		store.selectFile(key, "b.ts");
		store.advanceFile(key, 1);
		expect(sessionFor().activeFilePath).toBe("b.ts");
	});

	test("advanceFile -1 stops at first file", () => {
		const store = usePRReviewSessionStore.getState();
		store.setFileOrder(key, ["a.ts", "b.ts"]);
		store.selectFile(key, "a.ts");
		store.advanceFile(key, -1);
		expect(sessionFor().activeFilePath).toBe("a.ts");
	});

	test("setFileOrder clamps activeFilePath if it disappears", () => {
		const store = usePRReviewSessionStore.getState();
		store.setFileOrder(key, ["a.ts", "b.ts"]);
		store.selectFile(key, "b.ts");
		store.setFileOrder(key, ["a.ts", "c.ts"]);
		expect(sessionFor().activeFilePath).toBe("a.ts");
	});
});

describe("pr-review-session-store thread state", () => {
	beforeEach(reset);

	test("setThreadOrder clears stale activeThreadId", () => {
		const store = usePRReviewSessionStore.getState();
		store.setThreadOrder(key, [
			{ id: "t1", path: "a.ts" },
			{ id: "t2", path: "a.ts" },
		]);
		store.selectThread(key, "t2");
		store.setThreadOrder(key, [
			{ id: "t1", path: "a.ts" },
			{ id: "t3", path: "a.ts" },
		]);
		expect(sessionFor().activeThreadId).toBeNull();
	});

	test("selectThread sets activeThreadId; null clears it", () => {
		const store = usePRReviewSessionStore.getState();
		store.selectThread(key, "tX");
		expect(sessionFor().activeThreadId).toBe("tX");
		store.selectThread(key, null);
		expect(sessionFor().activeThreadId).toBeNull();
	});
});
