import { beforeEach, describe, expect, it } from "bun:test";
import { buildSidebarRows } from "../src/renderer/components/solve/SolveSidebar";
import type { SolveGroupInfo } from "../src/shared/solve-types";
import { useSolveSessionStore } from "../src/renderer/stores/solve-session-store";

function makeGroup(overrides: Partial<SolveGroupInfo> = {}): SolveGroupInfo {
	return {
		id: "g1",
		label: "Group one",
		status: "fixed",
		commitHash: "abc123def456",
		order: 0,
		changedFiles: [
			{ path: "src/a.ts", changeType: "M", additions: 3, deletions: 1 },
			{ path: "src/b.ts", changeType: "M", additions: 0, deletions: 5 },
		],
		comments: [
			{
				id: "c1",
				platformCommentId: "p1",
				author: "User",
				body: "comment",
				filePath: "src/a.ts",
				lineNumber: 10,
				side: null,
				threadId: null,
				status: "fixed",
				commitSha: null,
				groupId: "g1",
				followUpText: null,
				reply: null,
			},
		],
		...overrides,
	};
}

describe("buildSidebarRows", () => {
	it("maps changedFiles into rows with correct additions/deletions", () => {
		const rows = buildSidebarRows([makeGroup()]);
		const g1Rows = rows.get("g1")!;
		expect(g1Rows).toBeDefined();
		expect(g1Rows.length).toBe(2);
		expect(g1Rows[0]!.path).toBe("src/a.ts");
		expect(g1Rows[0]!.additions).toBe(3);
		expect(g1Rows[0]!.deletions).toBe(1);
		expect(g1Rows[0]!.isUnchanged).toBe(false);
		expect(g1Rows[1]!.path).toBe("src/b.ts");
		expect(g1Rows[1]!.deletions).toBe(5);
	});

	it("deduplicates files that appear multiple times in changedFiles", () => {
		const group = makeGroup({
			changedFiles: [
				{ path: "src/a.ts", changeType: "M", additions: 1, deletions: 0 },
				{ path: "src/a.ts", changeType: "M", additions: 2, deletions: 0 },
				{ path: "src/b.ts", changeType: "M", additions: 0, deletions: 1 },
			],
		});
		const rows = buildSidebarRows([group]);
		const g1Rows = rows.get("g1")!;
		expect(g1Rows.filter((r) => r.path === "src/a.ts").length).toBe(1);
		expect(g1Rows.length).toBe(2);
	});

	it("adds commented-on files not in changedFiles as isUnchanged rows", () => {
		const group = makeGroup({
			changedFiles: [{ path: "src/a.ts", changeType: "M", additions: 1, deletions: 0 }],
			comments: [
				{
					id: "c1",
					platformCommentId: "p1",
					author: "User",
					body: "comment",
					filePath: "src/extra.ts",
					lineNumber: 5,
					side: null,
					threadId: null,
					status: "fixed",
					commitSha: null,
					groupId: "g1",
					followUpText: null,
					reply: null,
				},
			],
		});
		const rows = buildSidebarRows([group]);
		const g1Rows = rows.get("g1")!;
		const extra = g1Rows.find((r) => r.path === "src/extra.ts");
		expect(extra).toBeDefined();
		expect(extra!.isUnchanged).toBe(true);
		expect(extra!.additions).toBe(0);
		expect(extra!.deletions).toBe(0);
	});

	it("does not add a comment file row if the file is already in changedFiles", () => {
		// src/a.ts is in changedFiles AND is the comment's filePath — should appear once
		const rows = buildSidebarRows([makeGroup()]);
		const g1Rows = rows.get("g1")!;
		expect(g1Rows.filter((r) => r.path === "src/a.ts").length).toBe(1);
		// Must keep the changedFiles entry (isUnchanged: false)
		expect(g1Rows.find((r) => r.path === "src/a.ts")!.isUnchanged).toBe(false);
	});

	it("returns an empty map entry for a group with no files and no comments", () => {
		const group = makeGroup({ changedFiles: [], comments: [] });
		const rows = buildSidebarRows([group]);
		expect(rows.get("g1")).toEqual([]);
	});
});

describe("SolveSidebar auto-select store invariants", () => {
	const SESSION_ID = "s1";

	beforeEach(() => {
		useSolveSessionStore.setState({ sessions: new Map() });
	});

	it("setExpandedGroups + selectFile lands the store in the expected auto-select state", () => {
		// This mirrors the first-load useEffect in SolveSidebar exactly:
		// setExpandedGroups(sessionId, new Set([first.id])) + selectFile(sessionId, firstRow.path)
		const { setExpandedGroups, selectFile } = useSolveSessionStore.getState();
		const firstGroupId = "g1";
		const firstFilePath = "src/a.ts";

		setExpandedGroups(SESSION_ID, new Set([firstGroupId]));
		selectFile(SESSION_ID, firstFilePath);

		const state = useSolveSessionStore.getState().sessions.get(SESSION_ID);
		expect(state?.expandedGroupIds.has(firstGroupId)).toBe(true);
		expect(state?.activeFilePath).toBe(firstFilePath);
	});

	it("buildSidebarRows first-file ordering determines the auto-selected file", () => {
		// The sidebar auto-selects rowsByGroup.get(first.id)?.[0].path
		// so the first row of the first group must be the first changedFile entry.
		const group = makeGroup();
		const rows = buildSidebarRows([group]);
		const firstRow = rows.get("g1")?.[0];
		expect(firstRow?.path).toBe("src/a.ts");
	});

	it("toggleGroupExpanded collapses a group the sidebar expanded", () => {
		const { setExpandedGroups, toggleGroupExpanded } = useSolveSessionStore.getState();
		setExpandedGroups(SESSION_ID, new Set(["g1"]));
		toggleGroupExpanded(SESSION_ID, "g1");
		const state = useSolveSessionStore.getState().sessions.get(SESSION_ID);
		expect(state?.expandedGroupIds.has("g1")).toBe(false);
	});

	it("selectFile updates activeFilePath to the clicked file", () => {
		const { selectFile } = useSolveSessionStore.getState();
		selectFile(SESSION_ID, "src/b.ts");
		const state = useSolveSessionStore.getState().sessions.get(SESSION_ID);
		expect(state?.activeFilePath).toBe("src/b.ts");
	});
});
