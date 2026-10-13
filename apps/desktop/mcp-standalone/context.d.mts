export interface McpContext {
	mode: string;
	projectId?: string;
	workspaceId?: string;
	isOrchestrator?: boolean;
	orchestratorEventsPath?: string;
	crossRepoOrchestratorId?: string;
	linkedProjectIds?: string[];
	modeContext?: Record<string, string | undefined>;
}

export function resolveContext(
	discovery: { port: number; token: string },
	options?: { cwd?: string; env?: Record<string, string | undefined> }
): Promise<McpContext>;
