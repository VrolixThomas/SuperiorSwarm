import type { HermesSessionMetadata } from "./hermes-session-admission.mjs";

export type HermesSessionTagOperation = "read" | "set" | "add" | "remove";
export type HermesReusableTagOperation =
	| "list_definitions"
	| "upsert_definition"
	| "update_definition"
	| "delete_definition"
	| "read_assignments"
	| "assign"
	| "unassign";

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

export function handleHermesReusableTagTool(input: {
	operation: HermesReusableTagOperation;
	args: Record<string, unknown>;
	extra: unknown;
	connectionId: string | null;
	call: (
		path: string,
		body: { connectionId: string; metadata: HermesSessionMetadata } & Record<string, unknown>
	) => Promise<HermesSessionTagToolResult>;
}): Promise<HermesSessionTagToolResult>;
