import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { log } from "../logger";
import { getAgentNotifyPort, getAgentNotifyToken } from "./port";

let permissionResponseEnabled = false;
export function setPermissionResponseEnabled(enabled: boolean): void {
	permissionResponseEnabled = enabled;
}

export function hookEndpointName(token: string, terminalId: string): string {
	return `${createHash("sha256").update(`${token}\0${terminalId}`).digest("hex")}.json`;
}

/** Bound to exact daemon-owned terminal identity; contains no bearer token. */
export function publishHookEndpoint(
	terminalId: string,
	port: number,
	token: string,
	directory = join(homedir(), ".agent-notify", "hooks", "endpoints")
): void {
	if (!terminalId || !token || !Number.isInteger(port) || port < 1 || port > 65535)
		throw new Error("Invalid hook endpoint identity");
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	const path = join(directory, hookEndpointName(token, terminalId));
	const content = JSON.stringify({
		port,
		...(permissionResponseEnabled ? { permissionResponse: 1 } : {}),
	});
	if (existsSync(path) && readFileSync(path, "utf8") === content) return;
	const temporary = `${path}.${process.pid}.tmp`;
	writeFileSync(temporary, content, { mode: 0o600 });
	renameSync(temporary, path);
}

export function publishCurrentHookEndpoint(terminalId: string): void {
	const port = getAgentNotifyPort();
	const token = getAgentNotifyToken();
	if (!port || !token) return;
	try {
		publishHookEndpoint(terminalId, port, token);
	} catch (error) {
		log.warn("[agent-hooks] terminal endpoint discovery could not be updated", error);
	}
}
