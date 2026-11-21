/** Accepted hook lifecycle, bound to the exact provider conversation and turn. */
export interface QueueTerminalState {
	provider: string;
	providerSessionId: string;
	turnId: string;
	phase: "prompt" | "idle" | "blocked" | "reset";
}
