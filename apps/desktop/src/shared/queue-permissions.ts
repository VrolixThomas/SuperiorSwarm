import type { WorkspaceQueueItem, WorkspaceQueueRevisionInput } from "./activity-queue";

export type QueuePermissionAction = "allow-once" | "deny" | "open";
export type QueuePermissionState =
	| "waiting"
	| "sent"
	| "delivered-to-hook"
	| "expired"
	| "cancelled"
	| "uncertain";
export interface QueuePermissionCapability {
	capability: "hook-response" | "unavailable";
	requestId?: string;
	allowOnce?: boolean;
	state?: QueuePermissionState;
	expiresAt?: number;
	summary?: string;
	detail: string;
}
export interface QueuePermissionDecisionInput extends WorkspaceQueueRevisionInput {
	requestId: string;
	action: QueuePermissionAction;
}
export type QueuePermissionDecisionResult = {
	status: "sent" | "opened" | "conflict" | "unavailable" | "uncertain";
	detail: string;
};
export interface QueuePermissionDecisionProps {
	item: WorkspaceQueueItem;
	capability: QueuePermissionCapability;
	onDecide: (input: QueuePermissionDecisionInput) => Promise<QueuePermissionDecisionResult>;
	onOpen: () => void;
	onChanged?: () => void;
}
