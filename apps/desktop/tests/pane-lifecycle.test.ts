import { describe, expect, test } from "bun:test";
import { terminalIdsInPane } from "../src/renderer/lib/pane-lifecycle";
import type { Pane } from "../src/shared/pane-types";

describe("terminalIdsInPane", () => {
	test("returns every terminal in the pane and excludes non-terminal tabs", () => {
		const pane: Pane = {
			type: "pane",
			id: "pane-1",
			activeTabId: "terminal-1",
			tabs: [
				{
					kind: "terminal",
					id: "terminal-1",
					workspaceId: "workspace-1",
					title: "Agent",
					cwd: "/tmp",
				},
				{
					kind: "file",
					id: "file-1",
					workspaceId: "workspace-1",
					title: "README",
					repoPath: "/tmp",
					filePath: "README.md",
					language: "markdown",
				},
				{
					kind: "terminal",
					id: "terminal-2",
					workspaceId: "workspace-1",
					title: "Server",
					cwd: "/tmp",
				},
			],
		};

		expect(terminalIdsInPane(pane)).toEqual(["terminal-1", "terminal-2"]);
	});
});
