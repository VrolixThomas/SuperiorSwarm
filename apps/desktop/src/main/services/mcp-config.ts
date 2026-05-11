import { join } from "node:path";
import { mergeKey } from "../ai-review/mcp-config-merge";

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

