import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SUPERIORSWARM_DIR } from "../shared/daemon-protocol";
import { removeOwnerFile, writeOwnerFile } from "./owner-file";
import { PtyManager } from "./pty-manager";
import { ScrollbackStore } from "./scrollback-store";
import { SocketServer } from "./socket-server";
const SOCKET_PATH =
	process.env["SUPERIORSWARM_SOCKET_PATH"] ?? join(SUPERIORSWARM_DIR, "daemon.sock");
const PID_PATH = process.env["SUPERIORSWARM_PID_PATH"] ?? join(SUPERIORSWARM_DIR, "daemon.pid");
const DB_PATH = process.env["SUPERIORSWARM_DB_PATH"] ?? "";
const OWNER_PATH = process.env["SUPERIORSWARM_OWNER_PATH"];
const APP_DIR_HASH = process.env["SUPERIORSWARM_APP_DIR_HASH"];
const IS_DEV = process.env["SUPERIORSWARM_DEV_MODE"] === "1";
const FLUSH_INTERVAL_MS = 30_000;

if (!DB_PATH) {
	console.error("[daemon] SUPERIORSWARM_DB_PATH not set, exiting");
	process.exit(1);
}

if (!existsSync(SUPERIORSWARM_DIR)) {
	mkdirSync(SUPERIORSWARM_DIR, { recursive: true });
}

// Remove stale socket from previous run
if (existsSync(SOCKET_PATH)) {
	try {
		rmSync(SOCKET_PATH);
	} catch {}
}

writeFileSync(PID_PATH, String(process.pid));
writeOwnerFile(OWNER_PATH, APP_DIR_HASH, process.pid, Date.now());

const ptyManager = new PtyManager();
const scrollbackStore = new ScrollbackStore(DB_PATH);
const socketServer = new SocketServer(ptyManager, scrollbackStore, SOCKET_PATH);

const flushInterval = setInterval(() => socketServer.flush(), FLUSH_INTERVAL_MS);

const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const DEV_ORPHAN_GRACE_MS = 20 * 60 * 1000; // 20 minutes before disposing orphaned PTYs in dev mode
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let devOrphanTimer: ReturnType<typeof setTimeout> | null = null;

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

	// Dev mode: dispose orphaned PTYs when no clients are connected.
	// In production, PTYs persist indefinitely for re-attachment.
	if (IS_DEV && socketServer.clientCount === 0 && ptyManager.terminalCount > 0) {
		if (!devOrphanTimer) {
			console.log(
				`[daemon] dev mode: no clients, disposing PTYs in ${DEV_ORPHAN_GRACE_MS / 1000}s`
			);
			devOrphanTimer = setTimeout(() => {
				devOrphanTimer = null;
				if (socketServer.clientCount > 0) return; // client reconnected
				console.log(`[daemon] dev mode: disposing ${ptyManager.terminalCount} orphaned PTY(s)`);
				socketServer.flush();
				ptyManager.disposeAll();
			}, DEV_ORPHAN_GRACE_MS);
		}
	} else if (devOrphanTimer) {
		clearTimeout(devOrphanTimer);
		devOrphanTimer = null;
	}
}

const idleCheckInterval = setInterval(checkIdle, 30_000);

function shutdown(): void {
	clearInterval(idleCheckInterval);
	if (idleTimer) clearTimeout(idleTimer);
	if (devOrphanTimer) clearTimeout(devOrphanTimer);
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
	removeOwnerFile(OWNER_PATH);
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
console.log(
	`[daemon] started, pid=${process.pid}, socket=${SOCKET_PATH}${IS_DEV ? " (dev mode)" : ""}`
);
