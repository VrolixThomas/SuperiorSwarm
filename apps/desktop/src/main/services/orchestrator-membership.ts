// Stub — implemented in Task 4 (orchestrator-membership).
// This file exists so Task 3 tests can load; tests that call attachToOrchestrator
// will fail until Task 4 replaces this stub with the real implementation.

export async function attachToOrchestrator(_input: {
	orchestratorId: string;
	workspaceId: string;
}): Promise<{ ok: true }> {
	throw new Error("attachToOrchestrator: not implemented (stub — see Task 4)");
}

export async function detachFromOrchestrator(_input: {
	orchestratorId: string;
	workspaceId: string;
}): Promise<{ ok: true }> {
	throw new Error("detachFromOrchestrator: not implemented (stub — see Task 4)");
}
