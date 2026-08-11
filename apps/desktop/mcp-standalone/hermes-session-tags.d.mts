import type { HermesSessionMetadata } from "./hermes-session-admission.mjs";

export type HermesSessionTagOperation = "read" | "set" | "add" | "remove";

export interface HermesSessionTagToolResult {
	content: Array<{ type: "text"; text: string }>;
	structuredContent?: Record<string, unknown>;
	isError?: boolean;
}

export function handleHermesSessionTagTool(input: {
	operation: HermesSessionTagOperation;
	args: Record<string, unknown>;
	extra: unknown;
	connectionId: string | null;
	call: (
		path: string,
		body: { connectionId: string; metadata: HermesSessionMetadata } & Record<string, unknown>
	) => Promise<HermesSessionTagToolResult>;
}): Promise<HermesSessionTagToolResult>;
