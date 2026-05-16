// Push-from-main event bridge for agent confirms. This intentionally uses raw
// ipcMain.on/handle — the rule "all IPC via tRPC" applies to renderer-initiated
// requests; push events are exposed to the renderer via contextBridge in the
// preload (see preload/index.ts agentConfirm.*).
import { randomUUID } from "node:crypto";
import type { BrowserWindow } from "electron";
import { ipcMain } from "electron";

export interface ConfirmRequest {
	kind: "dispatch" | "remove";
	workspaceName: string;
	branch: string | null;
	summary: string;
}

interface PendingConfirm {
	resolve: (allow: boolean) => void;
	timer: NodeJS.Timeout;
}

const TIMEOUT_MS = 30_000;
const MAX_QUEUE = 3;

const pending = new Map<string, PendingConfirm>();
let getWindow: () => BrowserWindow | null = () => null;
let registered = false;

export function registerConfirmBridge(getMainWindow: () => BrowserWindow | null): void {
	getWindow = getMainWindow;
	if (registered) return;
	registered = true;
	ipcMain.on("agent-confirm:reply", (_evt, payload: { id: string; allow: boolean }) => {
		const entry = pending.get(payload.id);
		if (!entry) return;
		clearTimeout(entry.timer);
		pending.delete(payload.id);
		entry.resolve(payload.allow === true);
	});
}

export async function requestConfirm(req: ConfirmRequest): Promise<boolean> {
	if (pending.size >= MAX_QUEUE) return false;
	const win = getWindow();
	if (!win) return false;

	const id = randomUUID();
	return new Promise<boolean>((resolve) => {
		const timer = setTimeout(() => {
			pending.delete(id);
			resolve(false);
		}, TIMEOUT_MS);
		pending.set(id, { resolve, timer });
		win.webContents.send("agent-confirm:request", { id, ...req });
	});
}

export function _drainAll(allow: boolean): void {
	if (process.env.NODE_ENV === "production") {
		throw new Error("_drainAll is not available in production");
	}
	for (const entry of pending.values()) {
		clearTimeout(entry.timer);
		entry.resolve(allow);
	}
	pending.clear();
}
