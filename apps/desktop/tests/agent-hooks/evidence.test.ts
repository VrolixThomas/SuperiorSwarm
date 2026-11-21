import { expect, test } from "bun:test";
import { admitAgentEvidence, validateAgentEvidence } from "../../src/shared/agent-evidence";
test("admits actual reply with provenance without importing prompts or tools", () => {
	const evidence = admitAgentEvidence(
		{
			last_assistant_message: "Which color: amber or blue?",
			prompt: "private",
			tool_input: { command: "private" },
			transcript_path: "/private",
		},
		"claude",
		"Stop"
	);
	expect(evidence).toEqual([
		{
			kind: "reply",
			text: "Which color: amber or blue?",
			sourceField: "last_assistant_message",
			provider: "claude",
			rawEvent: "Stop",
			truncated: false,
			redacted: false,
		},
	]);
	expect(
		admitAgentEvidence({ last_assistant_message: "not a Stop" }, "claude", "PreToolUse")
	).toEqual([]);
});
test("bounds and sanitizes provider text before transport/storage", () => {
	const [entry] = admitAgentEvidence(
		{
			last_assistant_message: `\x1b[31mRED\x1b[0m\u202e\0 Bearer synthetic_token password=syntheticsecret sk-abcdefghijklmnop ${"x".repeat(20000)}`,
		},
		"claude",
		"Stop"
	);
	expect(entry?.text).toStartWith(
		"RED Bearer [redacted] password=[redacted] [redacted credential]"
	);
	expect(entry?.text.length).toBeLessThanOrEqual(2048);
	expect(entry?.truncated).toBe(true);
	expect(entry?.redacted).toBe(true);
	expect(entry?.text).not.toContain("syntheticsecret");
});
test("listener admission reconstructs provenance and rejects forged/unknown fields", () => {
	const evidence = validateAgentEvidence(
		[
			{
				kind: "reply",
				sourceField: "last_assistant_message",
				text: "Synthetic",
				provider: "forged",
				rawEvent: "forged",
			},
			{ sourceField: "tool_input", text: "secret" },
		],
		"claude",
		"Stop"
	);
	expect(evidence).toHaveLength(1);
	expect(evidence[0]?.provider).toBe("claude");
	expect(evidence[0]?.rawEvent).toBe("Stop");
});
