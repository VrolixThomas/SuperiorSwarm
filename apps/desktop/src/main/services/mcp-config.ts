import { existsSync } from "node:fs";
import { join } from "node:path";
import { mergeKey } from "../ai-review/mcp-config-merge";
import { getDb } from "../db";
import { worktrees } from "../db/schema";

export interface WorkspaceMcpEnv {
	mcpServerPath: string;
	execPath: string;
	projectId: string;
	workspaceId: string;
	port: number;
	token: string;
}

function buildEntry(env: WorkspaceMcpEnv) {
	return {
		command: env.execPath,
		args: [env.mcpServerPath],
		env: {
			ELECTRON_RUN_AS_NODE: "1",
			WORKSPACE_AGENT: "1",
			PROJECT_ID: env.projectId,
			WORKSPACE_ID: env.workspaceId,
			SUPERIORSWARM_CONTROL_PORT: String(env.port),
			SUPERIORSWARM_CONTROL_TOKEN: env.token,
		},
	};
}

export function writeWorkspaceMcpJson(worktreePath: string, env: WorkspaceMcpEnv): void {
	const file = join(worktreePath, ".mcp.json");
	mergeKey(file, ["mcpServers", "superiorswarm"], buildEntry(env));
}

export function rewriteAllWorkspaceMcpJsons(env: WorkspaceMcpEnv): void {
	const db = getDb();
	const all = db.select({ path: worktrees.path }).from(worktrees).all();
	for (const row of all) {
		try {
			if (existsSync(row.path)) writeWorkspaceMcpJson(row.path, env);
		} catch {
			// best-effort
		}
	}
}
