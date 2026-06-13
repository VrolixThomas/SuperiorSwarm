import { describe, expect, test } from "bun:test";
import { resolveWorkspaceCwd } from "../src/main/services/workspace-cwd";

describe("resolveWorkspaceCwd", () => {
	test("worktree path wins", () => {
		expect(
			resolveWorkspaceCwd({ worktreePath: "/wt", folderPath: "/sub", repoPath: "/repo" })
		).toBe("/wt");
	});
	test("folderPath wins over repoPath", () => {
		expect(resolveWorkspaceCwd({ worktreePath: null, folderPath: "/sub", repoPath: "/repo" })).toBe(
			"/sub"
		);
	});
	test("falls back to repoPath", () => {
		expect(resolveWorkspaceCwd({ worktreePath: null, folderPath: null, repoPath: "/repo" })).toBe(
			"/repo"
		);
	});
});
