import { createHash } from "node:crypto";
import { constants, closeSync, fstatSync, openSync, readSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { parseDocument } from "yaml";
import { z } from "zod";
import {
	QUEUE_HOOK_CONFIG,
	QUEUE_HOOK_OUTPUT_BYTES,
	type QueueHookDefinition,
	type QueueHookOutput,
} from "../../shared/queue-hooks";

const identifier = z
	.string()
	.min(1)
	.max(160)
	.regex(/^[\w.-]+$/);
const hookSchema = z
	.object({
		id: identifier,
		title: z.string().trim().min(1).max(300),
		run: z.string().min(1).max(8192),
		every: z
			.string()
			.regex(/^[1-9]\d{0,3}[mh]$/)
			.default("5m"),
	})
	.strict();
const configSchema = z.object({ hooks: z.array(hookSchema).max(32) }).strict();
const outputSchema = z
	.object({
		key: z.string().min(1).max(256),
		title: z.string().trim().min(1).max(300),
		why: z.string().trim().min(1).max(4000),
		severity: z.enum(["info", "warning", "error"]).optional(),
		url: z
			.string()
			.max(2048)
			.url()
			.refine((url) => ["https:", "http:"].includes(new URL(url).protocol))
			.optional(),
		fixPrompt: z.string().trim().min(1).max(16000).optional(),
	})
	.strict();

export function parseQueueHookConfig(text: string): QueueHookDefinition[] {
	try {
		if (Buffer.byteLength(text) > QUEUE_HOOK_OUTPUT_BYTES) throw new Error();
		const document = parseDocument(text, { uniqueKeys: true });
		if (document.errors.length) throw new Error();
		const { hooks } = configSchema.parse(document.toJS({ maxAliasCount: 0 }));
		if (new Set(hooks.map((hook) => hook.id)).size !== hooks.length) throw new Error();
		return hooks;
	} catch {
		throw new Error("Invalid queue hook configuration.");
	}
}

export function readQueueHookConfig(projectPath: string) {
	const root = realpathSync(projectPath);
	const fd = openSync(join(root, QUEUE_HOOK_CONFIG), constants.O_RDONLY | constants.O_NONBLOCK);
	try {
		const stat = fstatSync(fd);
		if (!stat.isFile() || stat.size > QUEUE_HOOK_OUTPUT_BYTES)
			throw new Error("Invalid queue hook configuration.");
		const buffer = Buffer.alloc(QUEUE_HOOK_OUTPUT_BYTES + 1);
		let size = 0;
		while (size < buffer.length) {
			const read = readSync(fd, buffer, size, buffer.length - size, null);
			if (!read) break;
			size += read;
		}
		if (size > QUEUE_HOOK_OUTPUT_BYTES) throw new Error("Queue hook configuration is too large.");
		const bytes = buffer.subarray(0, size);
		const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
		const hash = createHash("sha256").update(root).update("\0").update(bytes).digest("hex");
		return { root, hash, text, hooks: parseQueueHookConfig(text) };
	} finally {
		closeSync(fd);
	}
}

export function parseQueueHookOutput(stdout: string): QueueHookOutput[] {
	try {
		if (Buffer.byteLength(stdout) > QUEUE_HOOK_OUTPUT_BYTES) throw new Error();
		const rows = stdout
			.split(/\r?\n/)
			.filter((line) => line.trim())
			.map((line) => outputSchema.parse(JSON.parse(line)));
		if (rows.length > 256 || new Set(rows.map((row) => row.key)).size !== rows.length)
			throw new Error();
		return rows;
	} catch {
		throw new Error("Hook returned invalid or incomplete JSON lines.");
	}
}

export function hookIntervalMs(hook: QueueHookDefinition): number {
	return Number.parseInt(hook.every, 10) * (hook.every.endsWith("h") ? 3_600_000 : 60_000);
}
