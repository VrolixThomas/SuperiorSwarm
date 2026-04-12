import { describe, expect, test } from "bun:test";
import { formatTerminalExitMessage } from "../src/renderer/components/Terminal";

describe("formatTerminalExitMessage", () => {
	test("shows explicit lost-session guidance for reconnect-loss exit (-1)", () => {
		const message = formatTerminalExitMessage(-1);

		expect(message).toContain("[Terminal session lost]");
		expect(message).toContain("cannot be resumed");
		expect(message).toContain("Open a new terminal tab to continue");
	});

	test("keeps normal process-exit message for healthy exits", () => {
		expect(formatTerminalExitMessage(0)).toBe(
			"\r\n\x1b[90m[Process exited with code 0]\x1b[0m\r\n"
		);
	});
});
