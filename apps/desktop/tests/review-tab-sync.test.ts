import { beforeEach, describe, expect, test } from "bun:test";
import { useReviewSessionStore } from "../src/renderer/stores/review-session-store";
import type { ScopedDiffFile } from "../src/shared/review-types";

function reset() {
	useReviewSessionStore.setState({
		activeSession: null,
		lastAllFiles: [],
		lastScopedFiles: [],
	});
}

function mk(path: string, scope: "working" | "branch"): ScopedDiffFile {
	return { path, status: "modified", additions: 0, deletions: 0, hunks: [], scope };
}

describe("sidebar sync via store", () => {
	beforeEach(reset);

	test("scope=all keeps selection across scope change if still in scope", () => {
		const s = useReviewSessionStore.getState();
		s.startSession({ workspaceId: "ws1", filePath: "a.ts" });
		s.setFileSnapshot(
			[mk("a.ts", "working"), mk("b.ts", "branch")],
			[mk("a.ts", "working"), mk("b.ts", "branch")],
		);
		s.setScope("working", [mk("a.ts", "working")]);
		expect(useReviewSessionStore.getState().activeSession!.scope).toBe("working");
		expect(useReviewSessionStore.getState().activeSession!.selectedFilePath).toBe("a.ts");
	});

	test("scope change jumps selection if out of scope", () => {
		const s = useReviewSessionStore.getState();
		s.startSession({ workspaceId: "ws1", filePath: "b.ts" });
		s.setScope("working", [mk("a.ts", "working")]);
		expect(useReviewSessionStore.getState().activeSession!.selectedFilePath).toBe("a.ts");
	});

	test("nextFile on scoped list stops at end", () => {
		const s = useReviewSessionStore.getState();
		const scoped = [mk("a.ts", "working"), mk("b.ts", "working")];
		s.startSession({ workspaceId: "ws1", filePath: "b.ts" });
		s.nextFile(scoped);
		expect(useReviewSessionStore.getState().activeSession!.selectedFilePath).toBe("b.ts");
	});

	test("setFileSnapshot updates lastAllFiles + lastScopedFiles", () => {
		const s = useReviewSessionStore.getState();
		s.startSession({ workspaceId: "ws1" });
		const all = [mk("a.ts", "working"), mk("b.ts", "branch")];
		const scoped = [mk("b.ts", "branch")];
		s.setFileSnapshot(all, scoped);
		expect(useReviewSessionStore.getState().lastAllFiles).toEqual(all);
		expect(useReviewSessionStore.getState().lastScopedFiles).toEqual(scoped);
	});

	test("endSession clears session but keeps lastAllFiles (survives until next setFileSnapshot)", () => {
		const s = useReviewSessionStore.getState();
		s.startSession({ workspaceId: "ws1" });
		s.setFileSnapshot([mk("a.ts", "working")], [mk("a.ts", "working")]);
		s.endSession();
		// session is null but last* survive until next setFileSnapshot
		expect(useReviewSessionStore.getState().activeSession).toBeNull();
		expect(useReviewSessionStore.getState().lastAllFiles.length).toBe(1);
	});
});
