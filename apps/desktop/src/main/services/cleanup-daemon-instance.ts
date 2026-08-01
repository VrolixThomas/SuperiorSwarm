import type { CleanupDaemonClient } from "./cleanup-daemon-client";

let instance: CleanupDaemonClient | null = null;

export function setCleanupDaemonClient(client: CleanupDaemonClient | null): void {
	instance = client;
}

export function getCleanupDaemonClient(): CleanupDaemonClient | null {
	return instance;
}

export function wakeCleanupDaemon(): void {
	instance?.wake();
}
