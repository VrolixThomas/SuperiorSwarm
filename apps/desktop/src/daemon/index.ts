import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BRANCHFLUX_DIR } from "../shared/daemon-protocol";
import { PtyManager } from "./pty-manager";
import { ScrollbackStore } from "./scrollback-store";
import { SocketServer } from "./socket-server";
const SOCKET_PATH =
	process.env["BRANCHFLUX_SOCKET_PATH"] ?? join(BRANCHFLUX_DIR, "daemon.sock");
const PID_PATH =
	process.env["BRANCHFLUX_PID_PATH"] ?? join(BRANCHFLUX_DIR, "daemon.pid");
const DB_PATH = process.env["BRANCHFLUX_DB_PATH"] ?? "";
const FLUSH_INTERVAL_MS = 30_000;

if (!DB_PATH) {
	console.error("[daemon] BRANCHFLUX_DB_PATH not set, exiting");
	process.exit(1);
}

if (!existsSync(BRANCHFLUX_DIR)) {
	mkdirSync(BRANCHFLUX_DIR, { recursive: true });
}

// Remove stale socket from previous run
if (existsSync(SOCKET_PATH)) {
	try {
		rmSync(SOCKET_PATH);
	} catch {}
}

writeFileSync(PID_PATH, String(process.pid));

const ptyManager = new PtyManager();
const scrollbackStore = new ScrollbackStore(DB_PATH);
const socketServer = new SocketServer(ptyManager, scrollbackStore, SOCKET_PATH);

const flushInterval = setInterval(() => socketServer.flush(), FLUSH_INTERVAL_MS);

const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
let idleTimer: ReturnType<typeof setTimeout> | null = null;

function checkIdle(): void {
	if (socketServer.clientCount === 0 && ptyManager.terminalCount === 0) {
		if (!idleTimer) {
			idleTimer = setTimeout(() => {
				console.log("[daemon] idle timeout reached, shutting down");
				shutdown();
			}, IDLE_TIMEOUT_MS);
		}
	} else if (idleTimer) {
		clearTimeout(idleTimer);
		idleTimer = null;
	}
}

const idleCheckInterval = setInterval(checkIdle, 30_000);

function shutdown(): void {
	clearInterval(idleCheckInterval);
	if (idleTimer) clearTimeout(idleTimer);
	clearInterval(flushInterval);
	socketServer.flush();
	socketServer.close();
	ptyManager.disposeAll();
	scrollbackStore.close();
	try {
		rmSync(SOCKET_PATH);
	} catch {}
	try {
		rmSync(PID_PATH);
	} catch {}
	process.exit(0);
}

for (const sig of ["SIGTERM", "SIGHUP", "SIGINT"] as const) {
	process.on(sig, shutdown);
}

process.on("uncaughtException", (err) => {
	console.error("[daemon] uncaughtException:", err);
	shutdown();
});

socketServer.listen();
console.log(`[daemon] started, pid=${process.pid}, socket=${SOCKET_PATH}`);
