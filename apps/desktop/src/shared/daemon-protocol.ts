import { homedir } from "node:os";
import { join } from "node:path";

export const BRANCHFLUX_DIR = join(homedir(), ".branchflux");

export type ClientMessage =
	| { type: "create"; id: string; cwd?: string }
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
