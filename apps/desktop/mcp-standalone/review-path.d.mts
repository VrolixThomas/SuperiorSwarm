import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
export function registerReviewPathTools(
	server: Pick<McpServer, "tool">,
	options: {
		context: { mode: string; modeContext?: Record<string, string | undefined> };
		discovery: { port: number; token: string };
		fetchImpl?: typeof fetch;
	}
): void;
