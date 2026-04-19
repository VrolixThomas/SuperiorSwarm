import { beforeEach, describe, expect, test } from "bun:test";
import { useReviewSessionStore } from "../src/renderer/stores/review-session-store";
import type { ScopedDiffFile } from "../src/shared/review-types";

function reset() {
	useReviewSessionStore.setState({ activeSession: null });
}

describe("review-session-store lifecycle", () => {
	beforeEach(reset);

	test("starts with no active session", () => {
		expect(useReviewSessionStore.getState().activeSession).toBeNull();
	});

	test("startSession creates a session with defaults", () => {
		useReviewSessionStore.getState().startSession({ workspaceId: "ws1" });
		const s = useReviewSessionStore.getState().activeSession;
		expect(s).not.toBeNull();
		expect(s!.workspaceId).toBe("ws1");
		expect(s!.scope).toBe("all");
		expect(s!.selectedFilePath).toBeNull();
		expect(s!.editSplitPaneId).toBeNull();
		expect(s!.editOverlay.size).toBe(0);
	});

	test("startSession with scope + filePath", () => {
		useReviewSessionStore
			.getState()
			.startSession({ workspaceId: "ws1", scope: "branch", filePath: "a.ts" });
		const s = useReviewSessionStore.getState().activeSession!;
		expect(s.scope).toBe("branch");
		expect(s.selectedFilePath).toBe("a.ts");
	});

	test("startSession on existing session updates fields, preserves overlay", () => {
		const s0 = useReviewSessionStore.getState();
		s0.startSession({ workspaceId: "ws1" });
		s0.pushOptimisticContent("a.ts", "edited");
		s0.startSession({ workspaceId: "ws1", scope: "working", filePath: "b.ts" });
		const s = useReviewSessionStore.getState().activeSession!;
		expect(s.scope).toBe("working");
		expect(s.selectedFilePath).toBe("b.ts");
		expect(s.editOverlay.get("a.ts")).toBe("edited");
	});

	test("startSession for a different workspace resets overlay", () => {
		const s0 = useReviewSessionStore.getState();
		s0.startSession({ workspaceId: "ws1" });
		s0.pushOptimisticContent("a.ts", "edited");
		s0.startSession({ workspaceId: "ws2" });
		const s = useReviewSessionStore.getState().activeSession!;
		expect(s.workspaceId).toBe("ws2");
		expect(s.editOverlay.size).toBe(0);
	});

	test("endSession clears to null", () => {
		useReviewSessionStore.getState().startSession({ workspaceId: "ws1" });
		useReviewSessionStore.getState().endSession();
		expect(useReviewSessionStore.getState().activeSession).toBeNull();
	});
});

function makeFiles(paths: Array<[string, "working" | "branch"]>): ScopedDiffFile[] {
	return paths.map(([path, scope]) => ({
		path,
		status: "modified" as const,
		additions: 0,
		deletions: 0,
		hunks: [],
		scope,
	}));
}

describe("review-session-store navigation", () => {
	beforeEach(reset);

	test("nextFile moves to next in list", () => {
		const files = makeFiles([
			["a.ts", "working"],
			["b.ts", "working"],
			["c.ts", "branch"],
		]);
		const s = useReviewSessionStore.getState();
		s.startSession({ workspaceId: "ws1", filePath: "a.ts" });
		s.nextFile(files);
		expect(useReviewSessionStore.getState().activeSession!.selectedFilePath).toBe("b.ts");
	});

	test("nextFile stops at the last file (no wrap)", () => {
		const files = makeFiles([
			["a.ts", "working"],
			["b.ts", "branch"],
		]);
		const s = useReviewSessionStore.getState();
		s.startSession({ workspaceId: "ws1", filePath: "b.ts" });
		s.nextFile(files);
		expect(useReviewSessionStore.getState().activeSession!.selectedFilePath).toBe("b.ts");
	});

	test("prevFile stops at the first file (no wrap)", () => {
		const files = makeFiles([
			["a.ts", "working"],
			["b.ts", "branch"],
		]);
		const s = useReviewSessionStore.getState();
		s.startSession({ workspaceId: "ws1", filePath: "a.ts" });
		s.prevFile(files);
		expect(useReviewSessionStore.getState().activeSession!.selectedFilePath).toBe("a.ts");
	});

	test("nextFile no-op on empty list", () => {
		const s = useReviewSessionStore.getState();
		s.startSession({ workspaceId: "ws1", filePath: "x.ts" });
		s.nextFile([]);
		expect(useReviewSessionStore.getState().activeSession!.selectedFilePath).toBe("x.ts");
	});

	test("nextFile from null selection picks first", () => {
		const files = makeFiles([["a.ts", "working"]]);
		const s = useReviewSessionStore.getState();
		s.startSession({ workspaceId: "ws1" });
		s.nextFile(files);
		expect(useReviewSessionStore.getState().activeSession!.selectedFilePath).toBe("a.ts");
	});
});

describe("review-session-store scope", () => {
	beforeEach(reset);

	test("setScope updates scope", () => {
		const s = useReviewSessionStore.getState();
		s.startSession({ workspaceId: "ws1" });
		s.setScope("branch");
		expect(useReviewSessionStore.getState().activeSession!.scope).toBe("branch");
	});

	test("setScope without scopedFiles leaves selection untouched", () => {
		const s = useReviewSessionStore.getState();
		s.startSession({ workspaceId: "ws1", filePath: "a.ts" });
		s.setScope("branch");
		expect(useReviewSessionStore.getState().activeSession!.selectedFilePath).toBe("a.ts");
	});

	test("setScope with scopedFiles reselects if current out-of-scope", () => {
		const scoped = makeFiles([["c.ts", "branch"]]);
		const s = useReviewSessionStore.getState();
		s.startSession({ workspaceId: "ws1", filePath: "a.ts" });
		s.setScope("branch", scoped);
		expect(useReviewSessionStore.getState().activeSession!.selectedFilePath).toBe("c.ts");
	});

	test("setScope preserves selection if still in scope", () => {
		const scoped = makeFiles([["a.ts", "branch"]]);
		const s = useReviewSessionStore.getState();
		s.startSession({ workspaceId: "ws1", filePath: "a.ts" });
		s.setScope("branch", scoped);
		expect(useReviewSessionStore.getState().activeSession!.selectedFilePath).toBe("a.ts");
	});

	test("setScope clears selection if scope is empty", () => {
		const s = useReviewSessionStore.getState();
		s.startSession({ workspaceId: "ws1", filePath: "a.ts" });
		s.setScope("branch", []);
		expect(useReviewSessionStore.getState().activeSession!.selectedFilePath).toBeNull();
	});
});
