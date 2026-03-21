import type { DaemonClient } from "./daemon-client";

let instance: DaemonClient | null = null;

export function setDaemonClient(client: DaemonClient): void {
	instance = client;
}

export function getDaemonClient(): DaemonClient | null {
	return instance;
}
