export const QUEUE_HOOK_CONFIG = ".superiorswarm/queue.yml";
export const QUEUE_HOOK_TIMEOUT_MS = 30_000;
export const QUEUE_HOOK_OUTPUT_BYTES = 65_536;

export interface QueueHookDefinition {
	id: string;
	title: string;
	run: string;
	every: string;
}

export interface QueueHookOutput {
	key: string;
	title: string;
	why: string;
	severity?: "info" | "warning" | "error";
	url?: string;
	fixPrompt?: string;
}

export interface QueueHookProjectStatus {
	projectId: string;
	projectName: string;
	root: string;
	hash: string | null;
	configText: string | null;
	hooks: QueueHookDefinition[];
	trusted: boolean;
	error: string | null;
}
