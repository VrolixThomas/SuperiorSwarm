import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { appSettings } from "../db/schema";

// Global toggle: when on, dispatch_agent calls from in-app orchestrators
// (per-repo orchestrator workspaces and cross-repo coordinator terminals) skip
// the approval modal. External managers are NOT covered — they keep their
// per-manager dispatch_policy. Lives outside the settings router so the
// control plane can read it without pulling in electron.

const KEY = "orchestratorAutoDispatch";

export function getOrchestratorAutoDispatch(): boolean {
	const row = getDb().select().from(appSettings).where(eq(appSettings.key, KEY)).get();
	return row?.value === "true";
}

export function setOrchestratorAutoDispatch(enabled: boolean): void {
	const value = enabled ? "true" : "false";
	getDb()
		.insert(appSettings)
		.values({ key: KEY, value })
		.onConflictDoUpdate({ target: appSettings.key, set: { value } })
		.run();
}
