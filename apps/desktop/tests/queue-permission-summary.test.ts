import { expect, test } from "bun:test";
import { permissionActionSummary } from "../src/shared/queue-permission-summary";
test("action preview bounds and redacts quoted credentials without forwarding arbitrary tool input", () => {
	const admitted = permissionActionSummary({
		tool_name: "Bash",
		tool_input: {
			command: `curl --password='secret with spaces' --data '{"token":"private value"}' https://u:password@example.test ${"x".repeat(6000)}`,
			env: { API_KEY: "never forward" },
			transcript: "never forward",
		},
	});
	const summary = admitted.text;
	expect(admitted.reviewable).toBe(false);
	expect(summary.length).toBeLessThanOrEqual(2048);
	for (const secret of ["secret with spaces", "private value", "u:password", "never forward"])
		expect(summary).not.toContain(secret);
	expect(summary).toContain("[redacted]");
});

test("complete known arguments can be reviewed, unknown or long ones cannot", () => {
	expect(
		permissionActionSummary({ tool_name: "Bash", tool_input: { command: "printf safe" } })
			.reviewable
	).toBe(true);
	for (const tool_input of [
		{ private_unknown: "x" },
		{ command: "safe", hidden: "danger" },
		{ command: "x".repeat(2000) },
		{},
	])
		expect(permissionActionSummary({ tool_name: "Bash", tool_input }).reviewable).toBe(false);
});
