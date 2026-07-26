import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

export const SUPERIORSWARM_DIR = join(homedir(), ".superiorswarm");

// Bumped whenever the daemon's wire behavior changes. The daemon reports it in
// "ready"; a client seeing a mismatch (or no version — protocol 1 daemons)
// restarts the daemon so fixes apply to long-lived daemons that survive app
// upgrades. Keep in sync mentally with detach/frame semantics changes.
export const DAEMON_PROTOCOL_VERSION = 2;

// Hard per-frame limit enforced by the daemon on inbound lines. The client
// must validate outbound frames against this — anything larger is discarded
// by the daemon without a reply.
export const MAX_FRAME_BYTES = 64_000;

// Scrollback kept per PTY in the daemon. An attach replays the whole buffer
// as a single frame, so the client's inbound buffer cap must accommodate it.
export const MAX_SCROLLBACK_CHARS = 200_000;

export function daemonInstanceId(appDir: string): string {
	return createHash("sha256").update(appDir).digest("hex").slice(0, 12);
}

export interface DaemonPaths {
	socketPath: string;
	pidPath: string;
	ownerPath: string;
	logPath: string;
}

export function daemonPaths(instanceId: string): DaemonPaths {
	return {
		socketPath: join(SUPERIORSWARM_DIR, `daemon-${instanceId}.sock`),
		pidPath: join(SUPERIORSWARM_DIR, `daemon-${instanceId}.pid`),
		ownerPath: join(SUPERIORSWARM_DIR, `daemon-${instanceId}.owner`),
		logPath: join(SUPERIORSWARM_DIR, `daemon-${instanceId}.log`),
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
	// protocolVersion is absent on protocol-1 daemons.
	| { type: "ready"; protocolVersion?: number }
	| { type: "sessions"; sessions: DaemonSession[] }
	// base64-encoded PTY output. replay=true marks a scrollback replay sent on
	// attach (not live output); fg is the PTY's foreground process name at
	// attach time. Optional so old daemons/clients interoperate.
	| { type: "data"; id: string; data: string; replay?: boolean; fg?: string }
	| { type: "exit"; id: string; code: number }
	| { type: "error"; id: string; message: string };

// Metadata attached to PTY data delivered to consumers. Present only for
// attach-time scrollback replay.
export type TerminalDataMeta = { replay: true; fg?: string };
