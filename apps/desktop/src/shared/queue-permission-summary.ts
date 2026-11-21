import { admitAgentEvidence } from "./agent-evidence";

/** Only known action fields; never transcripts, environment maps or arbitrary nested arguments. */
export function permissionActionSummary(payload: Record<string, unknown>): {
	text: string;
	reviewable: boolean;
} {
	const tool =
		typeof payload["tool_name"] === "string" ? payload["tool_name"].slice(0, 128) : "Unknown tool";
	const input = payload["tool_input"];
	const fields: string[] = [];
	if (input && typeof input === "object" && !Array.isArray(input)) {
		for (const key of ["command", "file_path", "path", "description", "phase", "needs"]) {
			const value = (input as Record<string, unknown>)[key];
			if (typeof value === "string") fields.push(`${key}: ${value.slice(0, 4096)}`);
		}
	}
	const summary = `${tool}\n${fields.length ? fields.join("\n") : "Action arguments unavailable; review the native prompt for full details."}`;
	const redacted = summary.replace(
		/((?:["']?(?:api[_-]?key|access[_-]?token|password|passwd|secret|token|authorization|cookie)["']?)\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;]+)/gi,
		"$1[redacted]"
	);
	const evidence = admitAgentEvidence(
		{ permission_prompt: redacted },
		"permission",
		"PermissionRequest"
	)[0];
	const keys =
		input && typeof input === "object" && !Array.isArray(input) ? Object.keys(input) : [];
	const reviewable =
		!!evidence &&
		!evidence.truncated &&
		!evidence.redacted &&
		redacted === summary &&
		keys.length > 0 &&
		keys.every(
			(key) =>
				["command", "file_path", "path", "description", "phase", "needs"].includes(key) &&
				typeof (input as Record<string, unknown>)[key] === "string" &&
				!!String((input as Record<string, unknown>)[key]).trim() &&
				String((input as Record<string, unknown>)[key]).length <= 1500
		);
	return { text: evidence?.text ?? "Requested action unavailable", reviewable };
}
