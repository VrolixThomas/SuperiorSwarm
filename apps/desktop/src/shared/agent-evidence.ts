import type { AgentEvidence } from "./agent-events";

/** Self-contained: serialized into the package-free hook bridge. Never ingest a transcript,
 * prompt, tool input/output, or arbitrary nested payload. Text is rendered as plain text.
 * Redaction covers common credentials; it cannot classify every private natural-language fact.
 */
export function admitAgentEvidence(
	payload: unknown,
	provider: string,
	rawEvent: string
): AgentEvidence[] {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
	const row = payload as Record<string, unknown>;
	const fields: [string, AgentEvidence["kind"]][] = [];
	if (["Stop", "Interrupt", "StopFailure"].includes(rawEvent)) {
		fields.push(["last_assistant_message", rawEvent === "StopFailure" ? "error" : "reply"]);
	}
	if (["StopFailure", "PostToolUseFailure"].includes(rawEvent)) {
		fields.push(["error_details", "error"], ["error", "error"], ["error_message", "error"]);
	}
	if (rawEvent === "PermissionRequest") {
		fields.push(
			["permission_prompt", "permission"],
			["message", "permission"],
			["tool_name", "permission"]
		);
	}
	if (rawEvent === "Question") fields.push(["question", "question"]);
	const result: AgentEvidence[] = [];
	let remaining = 4096;
	for (const [sourceField, kind] of fields) {
		const original = row[sourceField];
		if (typeof original !== "string" || !original.trim() || remaining <= 0) continue;
		// Bound processing as well as storage; strip terminal escapes/control and bidi spoofing.
		let text = original
			.slice(0, 16384)
			// biome-ignore lint/suspicious/noControlCharactersInRegex: remove terminal control sequences
			.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
			// biome-ignore lint/suspicious/noControlCharactersInRegex: remove terminal control sequences
			.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
			// biome-ignore lint/suspicious/noControlCharactersInRegex: strip nonprinting and bidi control characters
			.replace(/[\x00-\x08\x0b-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, "");
		const beforeRedaction = text;
		text = text
			.replace(
				/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g,
				"[redacted private key]"
			)
			.replace(
				/\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{12,})\b/g,
				"[redacted credential]"
			)
			.replace(/\b(Bearer\s+)[A-Za-z0-9._~+\/-]+=*/gi, "$1[redacted]")
			.replace(
				/\b((?:api[_-]?key|access[_-]?token|password|secret|authorization)\s*[:=]\s*)[^\s,;]+/gi,
				"$1[redacted]"
			)
			.replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[redacted]@")
			.trim();
		const limit = Math.min(2048, remaining);
		if (!text) continue;
		result.push({
			kind,
			text: text.slice(0, limit),
			sourceField,
			provider,
			rawEvent,
			truncated: original.length > 16384 || text.length > limit,
			redacted: beforeRedaction !== text,
		});
		remaining -= Math.min(text.length, limit);
	}
	return result;
}

/** Re-admit only known fields; never trust client-supplied provenance or sanitization flags. */
export function validateAgentEvidence(
	value: unknown,
	provider: string,
	rawEvent: string
): AgentEvidence[] {
	if (!Array.isArray(value)) return [];
	const output: AgentEvidence[] = [];
	for (const item of value.slice(0, 4)) {
		if (!item || typeof item !== "object") continue;
		const entry = item as Record<string, unknown>;
		if (typeof entry["sourceField"] !== "string") continue;
		for (const admitted of admitAgentEvidence(
			{ [entry["sourceField"]]: entry["text"] },
			provider,
			rawEvent
		)) {
			if (output.some((previous) => previous.sourceField === admitted.sourceField)) continue;
			output.push({
				...admitted,
				truncated: admitted.truncated || entry["truncated"] === true,
				redacted: admitted.redacted || entry["redacted"] === true,
			});
		}
	}
	let remaining = 4096;
	return output.flatMap((entry) => {
		if (remaining <= 0) return [];
		const text = entry.text.slice(0, remaining);
		remaining -= text.length;
		return [{ ...entry, text, truncated: entry.truncated || text.length < entry.text.length }];
	});
}
