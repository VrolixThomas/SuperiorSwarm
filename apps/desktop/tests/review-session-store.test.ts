import { beforeEach, describe, expect, test } from "bun:test";
import { useReviewSessionStore } from "../src/renderer/stores/review-session-store";

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
