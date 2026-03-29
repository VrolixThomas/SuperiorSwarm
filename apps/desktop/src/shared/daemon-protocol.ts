import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

export const BRANCHFLUX_DIR = join(homedir(), ".branchflux");

export function daemonInstanceId(appDir: string): string {
	return createHash("sha256").update(appDir).digest("hex").slice(0, 12);
}

export interface DaemonPaths {
	socketPath: string;
	pidPath: string;
	logPath: string;
}

export function daemonPaths(instanceId: string): DaemonPaths {
	return {
		socketPath: join(BRANCHFLUX_DIR, `daemon-${instanceId}.sock`),
		pidPath: join(BRANCHFLUX_DIR, `daemon-${instanceId}.pid`),
		logPath: join(BRANCHFLUX_DIR, `daemon-${instanceId}.log`),
	};
}

export type ClientMessage =
	| { type: "create"; id: string; cwd?: string; env?: Record<string, string> }
	| { type: "attach"; id: string }
	| { type: "detach"; id: string }
	| { type: "detach-all" }
	| { type: "write"; id: string; data: string }
	| { type: "resize"; id: string; cols: number; rows: number }
	| { type: "dispose"; id: string }
	| { type: "list" };

export type DaemonSession = { id: string; cwd: string; pid: number };

export type DaemonMessage =
	| { type: "ready" }
	| { type: "sessions"; sessions: DaemonSession[] }
	| { type: "data"; id: string; data: string } // base64-encoded PTY output
	| { type: "exit"; id: string; code: number }
	| { type: "error"; id: string; message: string };
