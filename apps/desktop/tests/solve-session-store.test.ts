import { beforeEach, describe, expect, it } from "bun:test";
import { solveSessionKey, useSolveSessionStore } from "../src/renderer/stores/solve-session-store";

const KEY = solveSessionKey("w1", "s1");

describe("solve-session-store", () => {
	beforeEach(() => {
		useSolveSessionStore.setState({ sessions: new Map() });
	});

	it("selectFile sets activeFilePath", () => {
		const { selectFile } = useSolveSessionStore.getState();
		selectFile(KEY, "src/foo.ts");
		expect(useSolveSessionStore.getState().sessions.get(KEY)?.activeFilePath).toBe("src/foo.ts");
	});

	it("selectFile to same path is a no-op (same Map reference)", () => {
		const { selectFile } = useSolveSessionStore.getState();
		selectFile(KEY, "src/foo.ts");
		const before = useSolveSessionStore.getState().sessions;
		selectFile(KEY, "src/foo.ts");
		expect(useSolveSessionStore.getState().sessions).toBe(before);
	});

	it("setFileOrder drops scroll entries for files no longer present", () => {
		const { setFileOrder, setScroll } = useSolveSessionStore.getState();
		setFileOrder(KEY, ["a.ts", "b.ts", "c.ts"]);
		setScroll(KEY, "a.ts", 100);
		setScroll(KEY, "b.ts", 200);
		setFileOrder(KEY, ["a.ts", "c.ts"]);
		const s = useSolveSessionStore.getState().sessions.get(KEY);
		expect(s?.scrollByFile.get("a.ts")).toBe(100);
		expect(s?.scrollByFile.has("b.ts")).toBe(false);
	});

	it("setFileOrder reselects to first file when active is removed", () => {
		const { setFileOrder, selectFile } = useSolveSessionStore.getState();
		setFileOrder(KEY, ["a.ts", "b.ts"]);
		selectFile(KEY, "b.ts");
		setFileOrder(KEY, ["a.ts", "c.ts"]);
		expect(useSolveSessionStore.getState().sessions.get(KEY)?.activeFilePath).toBe("a.ts");
	});

	it("setFileOrder keeps active file when still present", () => {
		const { setFileOrder, selectFile } = useSolveSessionStore.getState();
		setFileOrder(KEY, ["a.ts", "b.ts"]);
		selectFile(KEY, "b.ts");
		setFileOrder(KEY, ["a.ts", "b.ts", "c.ts"]);
		expect(useSolveSessionStore.getState().sessions.get(KEY)?.activeFilePath).toBe("b.ts");
	});

	it("advanceFile moves through fileOrder and clamps at ends", () => {
		const { setFileOrder, selectFile, advanceFile } = useSolveSessionStore.getState();
		setFileOrder(KEY, ["a.ts", "b.ts", "c.ts"]);
		selectFile(KEY, "a.ts");
		advanceFile(KEY, 1);
		expect(useSolveSessionStore.getState().sessions.get(KEY)?.activeFilePath).toBe("b.ts");
		advanceFile(KEY, 1);
		advanceFile(KEY, 1); // clamped
		expect(useSolveSessionStore.getState().sessions.get(KEY)?.activeFilePath).toBe("c.ts");
		advanceFile(KEY, -1);
		expect(useSolveSessionStore.getState().sessions.get(KEY)?.activeFilePath).toBe("b.ts");
	});

	it("toggleGroupExpanded flips a group's expanded state", () => {
		const { toggleGroupExpanded } = useSolveSessionStore.getState();
		toggleGroupExpanded(KEY, "g1");
		expect(useSolveSessionStore.getState().sessions.get(KEY)?.expandedGroupIds.has("g1")).toBe(
			true
		);
		toggleGroupExpanded(KEY, "g1");
		expect(useSolveSessionStore.getState().sessions.get(KEY)?.expandedGroupIds.has("g1")).toBe(
			false
		);
	});

	it("setExpandedGroups replaces the whole set", () => {
		const { setExpandedGroups } = useSolveSessionStore.getState();
		setExpandedGroups(KEY, new Set(["g1", "g2"]));
		expect(useSolveSessionStore.getState().sessions.get(KEY)?.expandedGroupIds.has("g1")).toBe(
			true
		);
		expect(useSolveSessionStore.getState().sessions.get(KEY)?.expandedGroupIds.has("g2")).toBe(
			true
		);
		setExpandedGroups(KEY, new Set(["g3"]));
		expect(useSolveSessionStore.getState().sessions.get(KEY)?.expandedGroupIds.has("g1")).toBe(
			false
		);
		expect(useSolveSessionStore.getState().sessions.get(KEY)?.expandedGroupIds.has("g3")).toBe(
			true
		);
	});

	it("dropSession removes a session", () => {
		const { selectFile, dropSession } = useSolveSessionStore.getState();
		selectFile(KEY, "a.ts");
		dropSession(KEY);
		expect(useSolveSessionStore.getState().sessions.has(KEY)).toBe(false);
	});

	it("dropSessionsForWorkspace removes all sessions for a workspace", () => {
		const { selectFile, dropSessionsForWorkspace } = useSolveSessionStore.getState();
		const key1 = solveSessionKey("w1", "s1");
		const key2 = solveSessionKey("w1", "s2");
		const key3 = solveSessionKey("w2", "s3");
		selectFile(key1, "a.ts");
		selectFile(key2, "b.ts");
		selectFile(key3, "c.ts");
		dropSessionsForWorkspace("w1");
		expect(useSolveSessionStore.getState().sessions.has(key1)).toBe(false);
		expect(useSolveSessionStore.getState().sessions.has(key2)).toBe(false);
		expect(useSolveSessionStore.getState().sessions.has(key3)).toBe(true);
	});

	it("getScroll returns undefined for unknown path", () => {
		const { getScroll } = useSolveSessionStore.getState();
		expect(getScroll(KEY, "missing.ts")).toBeUndefined();
	});

	it("commentsVisible defaults to true on a fresh session", () => {
		const { selectFile } = useSolveSessionStore.getState();
		selectFile(KEY, "a.ts");
		expect(useSolveSessionStore.getState().sessions.get(KEY)?.commentsVisible).toBe(true);
	});

	it("setCommentsVisible flips the flag", () => {
		const { setCommentsVisible } = useSolveSessionStore.getState();
		setCommentsVisible(KEY, false);
		expect(useSolveSessionStore.getState().sessions.get(KEY)?.commentsVisible).toBe(false);
		setCommentsVisible(KEY, true);
		expect(useSolveSessionStore.getState().sessions.get(KEY)?.commentsVisible).toBe(true);
	});

	it("setCommentsVisible to same value is a no-op (same Map reference)", () => {
		const { setCommentsVisible } = useSolveSessionStore.getState();
		setCommentsVisible(KEY, false);
		const before = useSolveSessionStore.getState().sessions;
		setCommentsVisible(KEY, false);
		expect(useSolveSessionStore.getState().sessions).toBe(before);
	});

	it("toggleCommentsVisible flips between true and false", () => {
		const { toggleCommentsVisible } = useSolveSessionStore.getState();
		toggleCommentsVisible(KEY);
		expect(useSolveSessionStore.getState().sessions.get(KEY)?.commentsVisible).toBe(false);
		toggleCommentsVisible(KEY);
		expect(useSolveSessionStore.getState().sessions.get(KEY)?.commentsVisible).toBe(true);
	});

	it("dropSession clears commentsVisible state", () => {
		const { setCommentsVisible, dropSession } = useSolveSessionStore.getState();
		setCommentsVisible(KEY, false);
		dropSession(KEY);
		expect(useSolveSessionStore.getState().sessions.has(KEY)).toBe(false);
	});
});
