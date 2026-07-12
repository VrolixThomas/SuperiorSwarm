import { readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentSessionInfo } from "../../shared/agent-launch-types";

const CLAUDE_FILE_RE = /^[0-9a-f-]{36}\.jsonl$/i;
const CODEX_FILE_RE = /^rollout-.*\.jsonl$/;
const MAX_LABEL_LEN = 80;
const CLAUDE_READ_BYTES = 256 * 1024;
const CODEX_READ_BYTES = 16 * 1024;
const CODEX_MAX_FILES_SCANNED = 500;

export function claudeProjectSlug(cwd: string): string {
	return cwd.replace(/[^a-zA-Z0-9]/g, "-");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function tryParseJson(line: string): unknown {
	const trimmed = line.trim();
	if (!trimmed) return undefined;
	try {
		return JSON.parse(trimmed);
	} catch {
		return undefined;
	}
}

function finalizeLabel(text: string): string {
	return text.trim().replace(/\r?\n/g, " ").slice(0, MAX_LABEL_LEN);
}

function sortDesc(values: string[]): string[] {
	return [...values].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
}

function extractClaudeUserText(obj: Record<string, unknown>): string | undefined {
	const message = obj["message"];
	if (!isRecord(message)) return undefined;
	const content = message["content"];
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		for (const item of content) {
			if (isRecord(item) && item["type"] === "text" && typeof item["text"] === "string") {
				return item["text"];
			}
		}
	}
	return undefined;
}

function claudeLabelFromLines(lines: string[], sessionId: string): string {
	let summaryLabel: string | undefined;
	for (const line of lines) {
		const obj = tryParseJson(line);
		if (isRecord(obj) && obj["type"] === "summary" && typeof obj["summary"] === "string") {
			summaryLabel = obj["summary"];
		}
	}
	if (summaryLabel !== undefined) return finalizeLabel(summaryLabel);

	for (const line of lines) {
		const obj = tryParseJson(line);
		if (isRecord(obj) && obj["type"] === "user") {
			const text = extractClaudeUserText(obj);
			if (text && text.trim().length > 0 && !text.trimStart().startsWith("<")) {
				return finalizeLabel(text);
			}
		}
	}
	return sessionId.slice(0, 8);
}

export function listClaudeSessions(
	cwd: string,
	limit: number,
	rootDir: string = join(homedir(), ".claude", "projects")
): AgentSessionInfo[] {
	const dir = join(rootDir, claudeProjectSlug(cwd));
	let files: string[];
	try {
		files = readdirSync(dir);
	} catch {
		return [];
	}

	const candidates = files
		.filter((f) => CLAUDE_FILE_RE.test(f))
		.flatMap((f) => {
			const path = join(dir, f);
			try {
				const mtimeMs = statSync(path).mtimeMs;
				return [{ path, mtimeMs, sessionId: f.replace(/\.jsonl$/i, "") }];
			} catch {
				return [];
			}
		})
		.sort((a, b) => b.mtimeMs - a.mtimeMs)
		.slice(0, limit);

	return candidates.map((c) => {
		let label: string;
		try {
			const raw = readFileSync(c.path, "utf-8").slice(0, CLAUDE_READ_BYTES);
			label = claudeLabelFromLines(raw.split("\n"), c.sessionId);
		} catch {
			label = c.sessionId.slice(0, 8);
		}
		return { cli: "claude", sessionId: c.sessionId, label, lastActiveAt: c.mtimeMs };
	});
}

function* walkCodexRolloutFiles(rootDir: string): Generator<string> {
	let years: string[];
	try {
		years = readdirSync(rootDir);
	} catch {
		return;
	}
	for (const year of sortDesc(years)) {
		const yearDir = join(rootDir, year);
		let months: string[];
		try {
			months = readdirSync(yearDir);
		} catch {
			continue;
		}
		for (const month of sortDesc(months)) {
			const monthDir = join(yearDir, month);
			let days: string[];
			try {
				days = readdirSync(monthDir);
			} catch {
				continue;
			}
			for (const day of sortDesc(days)) {
				const dayDir = join(monthDir, day);
				let files: string[];
				try {
					files = readdirSync(dayDir);
				} catch {
					continue;
				}
				const rolloutFiles = sortDesc(files.filter((f) => CODEX_FILE_RE.test(f)));
				for (const file of rolloutFiles) {
					yield join(dayDir, file);
				}
			}
		}
	}
}

export function listCodexSessions(
	cwd: string,
	limit: number,
	rootDir: string = join(homedir(), ".codex", "sessions")
): AgentSessionInfo[] {
	const result: AgentSessionInfo[] = [];
	let scanned = 0;

	for (const path of walkCodexRolloutFiles(rootDir)) {
		if (scanned >= CODEX_MAX_FILES_SCANNED || result.length >= limit) break;
		scanned++;

		try {
			const raw = readFileSync(path, "utf-8").slice(0, CODEX_READ_BYTES);
			const lines = raw.split("\n");
			const firstLine = lines[0];
			if (firstLine === undefined) continue;

			const meta = tryParseJson(firstLine);
			if (!isRecord(meta) || meta["type"] !== "session_meta") continue;

			const payload = meta["payload"];
			if (!isRecord(payload) || payload["cwd"] !== cwd) continue;

			const sessionId =
				typeof payload["id"] === "string"
					? payload["id"]
					: typeof payload["session_id"] === "string"
						? payload["session_id"]
						: undefined;
			if (!sessionId) continue;

			let label: string | undefined;
			for (const line of lines.slice(1)) {
				const obj = tryParseJson(line);
				const eventPayload = isRecord(obj) ? obj["payload"] : undefined;
				if (
					isRecord(obj) &&
					obj["type"] === "event_msg" &&
					isRecord(eventPayload) &&
					eventPayload["type"] === "user_message" &&
					typeof eventPayload["message"] === "string"
				) {
					label = eventPayload["message"];
					break;
				}
			}

			const mtimeMs = statSync(path).mtimeMs;
			result.push({
				cli: "codex",
				sessionId,
				label: label !== undefined ? finalizeLabel(label) : sessionId.slice(0, 8),
				lastActiveAt: mtimeMs,
			});
		} catch {
			// Corrupt first line (or unreadable file): skip. Unlike claude, we can't
			// attribute a corrupt codex file to a cwd without parsing session_meta.
		}
	}

	return result;
}

export function listAgentSessionsForCwd(
	cwd: string,
	limitPerCli: number,
	roots?: { claudeRoot?: string; codexRoot?: string }
): AgentSessionInfo[] {
	const claude = listClaudeSessions(cwd, limitPerCli, roots?.claudeRoot);
	const codex = listCodexSessions(cwd, limitPerCli, roots?.codexRoot);
	return [...claude, ...codex].sort((a, b) => b.lastActiveAt - a.lastActiveAt);
}
