/** Read-time context only: never an attention source or acknowledgement receipt. */
export interface QueueLinkedWork {
	kind: "ticket" | "pr";
	provider: "linear" | "jira" | "github" | "bitbucket";
	id: string;
	label: string;
	title?: string;
	url?: string;
	metadata: "cached" | "unavailable";
	updatedAt?: number;
	unavailableReason?: string;
}
