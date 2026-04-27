import { beforeEach, describe, expect, it } from "bun:test";
import { useSolveSessionStore } from "../src/renderer/stores/solve-session-store";

describe("solve-session-store", () => {
	beforeEach(() => {
		useSolveSessionStore.setState({ sessions: new Map() });
	});

	it("selectFile sets activeFilePath", () => {
		const { selectFile } = useSolveSessionStore.getState();
		selectFile("s1", "src/foo.ts");
		expect(useSolveSessionStore.getState().sessions.get("s1")?.activeFilePath).toBe("src/foo.ts");
	});

	it("selectFile to same path is a no-op (same Map reference)", () => {
		const { selectFile } = useSolveSessionStore.getState();
		selectFile("s1", "src/foo.ts");
		const before = useSolveSessionStore.getState().sessions;
		selectFile("s1", "src/foo.ts");
		expect(useSolveSessionStore.getState().sessions).toBe(before);
	});

	it("setFileOrder drops scroll entries for files no longer present", () => {
		const { setFileOrder, setScroll } = useSolveSessionStore.getState();
		setFileOrder("s1", ["a.ts", "b.ts", "c.ts"]);
		setScroll("s1", "a.ts", 100);
		setScroll("s1", "b.ts", 200);
		setFileOrder("s1", ["a.ts", "c.ts"]);
		const s = useSolveSessionStore.getState().sessions.get("s1");
		expect(s?.scrollByFile.get("a.ts")).toBe(100);
		expect(s?.scrollByFile.has("b.ts")).toBe(false);
	});

	it("setFileOrder reselects to first file when active is removed", () => {
		const { setFileOrder, selectFile } = useSolveSessionStore.getState();
		setFileOrder("s1", ["a.ts", "b.ts"]);
		selectFile("s1", "b.ts");
		setFileOrder("s1", ["a.ts", "c.ts"]);
		expect(useSolveSessionStore.getState().sessions.get("s1")?.activeFilePath).toBe("a.ts");
	});

	it("setFileOrder keeps active file when still present", () => {
		const { setFileOrder, selectFile } = useSolveSessionStore.getState();
		setFileOrder("s1", ["a.ts", "b.ts"]);
		selectFile("s1", "b.ts");
		setFileOrder("s1", ["a.ts", "b.ts", "c.ts"]);
		expect(useSolveSessionStore.getState().sessions.get("s1")?.activeFilePath).toBe("b.ts");
	});

	it("advanceFile moves through fileOrder and clamps at ends", () => {
		const { setFileOrder, selectFile, advanceFile } = useSolveSessionStore.getState();
		setFileOrder("s1", ["a.ts", "b.ts", "c.ts"]);
		selectFile("s1", "a.ts");
		advanceFile("s1", 1);
		expect(useSolveSessionStore.getState().sessions.get("s1")?.activeFilePath).toBe("b.ts");
		advanceFile("s1", 1);
		advanceFile("s1", 1); // clamped
		expect(useSolveSessionStore.getState().sessions.get("s1")?.activeFilePath).toBe("c.ts");
		advanceFile("s1", -1);
		expect(useSolveSessionStore.getState().sessions.get("s1")?.activeFilePath).toBe("b.ts");
	});

	it("toggleGroupExpanded flips a group's expanded state", () => {
		const { toggleGroupExpanded } = useSolveSessionStore.getState();
		toggleGroupExpanded("s1", "g1");
		expect(useSolveSessionStore.getState().sessions.get("s1")?.expandedGroupIds.has("g1")).toBe(
			true
		);
		toggleGroupExpanded("s1", "g1");
		expect(useSolveSessionStore.getState().sessions.get("s1")?.expandedGroupIds.has("g1")).toBe(
			false
		);
	});

	it("setExpandedGroups replaces the whole set", () => {
		const { setExpandedGroups } = useSolveSessionStore.getState();
		setExpandedGroups("s1", new Set(["g1", "g2"]));
		expect(useSolveSessionStore.getState().sessions.get("s1")?.expandedGroupIds.has("g1")).toBe(
			true
		);
		expect(useSolveSessionStore.getState().sessions.get("s1")?.expandedGroupIds.has("g2")).toBe(
			true
		);
		setExpandedGroups("s1", new Set(["g3"]));
		expect(useSolveSessionStore.getState().sessions.get("s1")?.expandedGroupIds.has("g1")).toBe(
			false
		);
		expect(useSolveSessionStore.getState().sessions.get("s1")?.expandedGroupIds.has("g3")).toBe(
			true
		);
	});

	it("dropSession removes a session", () => {
		const { selectFile, dropSession } = useSolveSessionStore.getState();
		selectFile("s1", "a.ts");
		dropSession("s1");
		expect(useSolveSessionStore.getState().sessions.has("s1")).toBe(false);
	});

	it("getScroll returns undefined for unknown path", () => {
		const { getScroll } = useSolveSessionStore.getState();
		expect(getScroll("s1", "missing.ts")).toBeUndefined();
	});
});
