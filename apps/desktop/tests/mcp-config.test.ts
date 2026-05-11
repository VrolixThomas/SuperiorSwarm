import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeWorkspaceMcpJson } from "../src/main/services/mcp-config";

let TMP: string;

beforeEach(() => {
	TMP = mkdtempSync(join(tmpdir(), "mcp-config-"));
});
afterEach(() => {
	rmSync(TMP, { recursive: true, force: true });
});

const ENV = {
	mcpServerPath: "/app/server.mjs",
	execPath: "/app/electron",
	projectId: "proj-1",
	workspaceId: "ws-1",
	port: 51234,
	token: "t".repeat(64),
};

describe("writeWorkspaceMcpJson", () => {
	test("writes a fresh .mcp.json when none exists", () => {
		writeWorkspaceMcpJson(TMP, ENV);
		const raw = JSON.parse(readFileSync(join(TMP, ".mcp.json"), "utf-8"));
		expect(raw.mcpServers.superiorswarm.command).toBe("/app/electron");
		expect(raw.mcpServers.superiorswarm.env.SUPERIORSWARM_CONTROL_PORT).toBe("51234");
		expect(raw.mcpServers.superiorswarm.env.WORKSPACE_AGENT).toBe("1");
		expect(raw.mcpServers.superiorswarm.env.PROJECT_ID).toBe("proj-1");
		expect(raw.mcpServers.superiorswarm.env.WORKSPACE_ID).toBe("ws-1");
	});

	test("preserves user's other mcp servers, replaces only superiorswarm entry", () => {
		writeFileSync(
			join(TMP, ".mcp.json"),
			JSON.stringify({
				mcpServers: {
					myserver: { command: "node", args: ["x.mjs"] },
					superiorswarm: { command: "stale", args: [], env: {} },
				},
			})
		);
		writeWorkspaceMcpJson(TMP, ENV);
		const raw = JSON.parse(readFileSync(join(TMP, ".mcp.json"), "utf-8"));
		expect(raw.mcpServers.myserver.command).toBe("node");
		expect(raw.mcpServers.superiorswarm.command).toBe("/app/electron");
	});

	test("overwrites cleanly when only existing server is superiorswarm", () => {
		writeFileSync(
			join(TMP, ".mcp.json"),
			JSON.stringify({ mcpServers: { superiorswarm: { command: "stale" } } })
		);
		writeWorkspaceMcpJson(TMP, ENV);
		const raw = JSON.parse(readFileSync(join(TMP, ".mcp.json"), "utf-8"));
		expect(raw.mcpServers.superiorswarm.command).toBe("/app/electron");
	});
});
