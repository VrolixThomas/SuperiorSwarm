import { describe, expect, test } from "bun:test";
import {
	controlPlaneToolResult,
	workspaceCreatedArtifact,
} from "../mcp-standalone/structured-artifact.mjs";

describe("SuperiorSwarm MCP workspace artifact", () => {
	test("projects the create response into the approved structured artifact", () => {
		const response = {
			workspaceId: "workspace-1",
			projectId: "project-1",
			path: "/repos/app-worktrees/feat/hermes",
			branch: "feat/hermes",
		};
		expect(workspaceCreatedArtifact(response)).toEqual({
			kind: "superiorswarm.workspace.created",
			workspaceId: "workspace-1",
			projectId: "project-1",
			branch: "feat/hermes",
			worktreePath: "/repos/app-worktrees/feat/hermes",
		});
	});

	test("keeps legacy text content while adding MCP structuredContent", () => {
		const artifact = {
			kind: "superiorswarm.workspace.created" as const,
			workspaceId: "workspace-1",
			projectId: "project-1",
			branch: "feat/hermes",
			worktreePath: "/repos/app-worktrees/feat/hermes",
		};
		const response = { workspaceId: "workspace-1", artifact };
		const result = controlPlaneToolResult(response);

		expect(result.content).toEqual([{ type: "text", text: JSON.stringify(response) }]);
		expect(result.structuredContent).toEqual(artifact);
	});
});
