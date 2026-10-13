import { WorkspaceError, workspaceErrorMessages } from "./workspace-errors";

const messages = {
	...workspaceErrorMessages,
	TERMINAL_WORKSPACE_MISMATCH:
		"Terminal workspace mismatch. Reopen the terminal from its workspace.",
	TERMINAL_NOT_AUTHORIZED: "This terminal is not authorized for this window.",
	DAEMON_UNAVAILABLE: "The background terminal daemon could not be reached.",
	TERMINAL_CREATE_FAILED:
		"The terminal could not be started. Check the application logs for details.",
} as const;
export type TerminalCreateErrorCode = keyof typeof messages;
export type TerminalCreateResult =
	| { wasAttached: boolean; error?: never }
	| { error: { code: TerminalCreateErrorCode; message: string }; wasAttached?: never };

export class TerminalCreateError extends Error {
	constructor(public readonly code: TerminalCreateErrorCode) {
		super(messages[code]);
	}
}

function isCode(code: string): code is TerminalCreateErrorCode {
	return Object.hasOwn(messages, code);
}

export function terminalCreateErrorCode(error: unknown): TerminalCreateErrorCode {
	if (error instanceof WorkspaceError || error instanceof TerminalCreateError) return error.code;
	const message = error instanceof Error ? error.message : "";
	const encoded = message.match(/\[TERMINAL_CREATE:([A-Z_]+)\]/)?.[1];
	if (encoded && isCode(encoded)) return encoded;
	// Compatibility with errors from an older main/preload. Never echo their
	// raw messages: Electron wraps them and filesystem errors may contain paths.
	if (/Workspace not found(?::|\.)/.test(message)) return "WORKSPACE_NOT_FOUND";
	if (/Workspace folder no longer exists(?::|\.)/.test(message)) return "WORKSPACE_FOLDER_MISSING";
	if (
		/^(?:Terminal daemon is not connected|Daemon not connected|Timed out waiting for daemon message: sessions)$/.test(
			message
		) ||
		(error instanceof Error &&
			"code" in error &&
			["ECONNREFUSED", "ECONNRESET", "EPIPE", "ENOTCONN"].includes(String(error.code)))
	)
		return "DAEMON_UNAVAILABLE";
	return "TERMINAL_CREATE_FAILED";
}

export function terminalCreateFailure(error: unknown): TerminalCreateResult {
	const code = terminalCreateErrorCode(error);
	return { error: { code, message: messages[code] } };
}

/** IPC uses a plain result; contextBridge only reliably preserves Error.message. */
export function unwrapTerminalCreateResult(result: TerminalCreateResult): { wasAttached: boolean } {
	if (result.error) {
		const code = isCode(result.error.code) ? result.error.code : "TERMINAL_CREATE_FAILED";
		throw new Error(`[TERMINAL_CREATE:${code}] ${messages[code]}`);
	}
	return result;
}

export function terminalCreateErrorMessage(error: unknown): string {
	const code = terminalCreateErrorCode(error);
	if (code === "DAEMON_UNAVAILABLE")
		return `\r\n\x1b[31m[Terminal daemon is unavailable]\x1b[0m\r\n\x1b[90m${messages[code]}\r\nReconnection will be attempted automatically.\x1b[0m\r\n`;
	const workspace = code.startsWith("WORKSPACE_") || code === "TERMINAL_WORKSPACE_MISMATCH";
	return `\r\n\x1b[31m[${workspace ? "Workspace unavailable" : "Terminal could not start"}]\x1b[0m\r\n\x1b[90m${messages[code]}\r\n${workspace ? "Check the workspace and its folder, then retry or close this tab." : "Retry the terminal when the problem is resolved."}\x1b[0m\r\n`;
}
