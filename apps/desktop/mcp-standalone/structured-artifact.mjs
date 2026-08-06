const WORKSPACE_CREATED_KIND = "superiorswarm.workspace.created";

function isWorkspaceCreatedArtifact(value) {
	return (
		value &&
		typeof value === "object" &&
		value.kind === WORKSPACE_CREATED_KIND &&
		typeof value.workspaceId === "string" &&
		typeof value.projectId === "string" &&
		typeof value.branch === "string" &&
		typeof value.worktreePath === "string"
	);
}

export function workspaceCreatedArtifact(value) {
	if (!value || typeof value !== "object") return null;
	if (isWorkspaceCreatedArtifact(value.artifact)) return value.artifact;
	if (
		typeof value.workspaceId !== "string" ||
		typeof value.projectId !== "string" ||
		typeof value.branch !== "string" ||
		typeof value.path !== "string"
	) {
		return null;
	}
	return {
		kind: WORKSPACE_CREATED_KIND,
		workspaceId: value.workspaceId,
		projectId: value.projectId,
		branch: value.branch,
		worktreePath: value.path,
	};
}

export function controlPlaneToolResult(value) {
	const artifact = workspaceCreatedArtifact(value);
	return {
		content: [{ type: "text", text: JSON.stringify(value) }],
		...(artifact ? { structuredContent: artifact } : {}),
	};
}
