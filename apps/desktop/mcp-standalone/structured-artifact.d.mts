import type { HermesWorkspaceArtifact } from "../src/shared/hermes";

export function workspaceCreatedArtifact(value: unknown): HermesWorkspaceArtifact | null;

export function controlPlaneToolResult(value: unknown): {
	content: Array<{ type: "text"; text: string }>;
	structuredContent?: HermesWorkspaceArtifact;
};
