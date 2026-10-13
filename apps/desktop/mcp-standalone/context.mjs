/** Resolve the caller once at MCP startup and retain that identity for tool calls. */
export async function resolveContext(discovery, { cwd = process.cwd(), env = process.env } = {}) {
	const params = new URLSearchParams({ cwd });
	const taskToken = env.SUPERIORSWARM_TASK_TOKEN;
	if (taskToken) params.set("taskToken", taskToken);
	const headers = { Authorization: `Bearer ${discovery.token}` };
	// Task and external-manager launches take precedence over the terminal they
	// inherited. Ordinary app terminals already carry their exact workspace ID,
	// including folder workspaces that share a cwd and cross-repo coordinators.
	if (!taskToken) {
		if (env.SUPERIORSWARM_MANAGER_TOKEN) {
			headers["X-Manager-Token"] = env.SUPERIORSWARM_MANAGER_TOKEN;
		} else if (env.AGENT_NOTIFY_WORKSPACE_ID) {
			headers["X-Workspace-Id"] = env.AGENT_NOTIFY_WORKSPACE_ID;
		}
	}
	const res = await fetch(`http://127.0.0.1:${discovery.port}/context.resolve?${params}`, {
		headers,
	});
	const context = await res.json();
	if (!res.ok) {
		throw new Error(
			`/context.resolve ${res.status}${typeof context.message === "string" ? `: ${context.message}` : ""}`
		);
	}
	return context;
}
