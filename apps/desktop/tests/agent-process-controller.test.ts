import { describe, expect, test } from "bun:test";
import {
	matchesProviderCommand,
	matchesProviderProcessGroup,
} from "../src/main/services/agent-process-controller";

describe("matchesProviderCommand", () => {
	test("recognizes direct provider executables", () => {
		expect(matchesProviderCommand("/Users/me/.local/bin/claude --resume abc", "claude")).toBe(true);
		expect(matchesProviderCommand("/opt/homebrew/bin/codex resume abc", "codex")).toBe(true);
		expect(matchesProviderCommand("gemini --resume abc", "gemini")).toBe(true);
		expect(matchesProviderCommand("/usr/local/bin/opencode --session abc", "opencode")).toBe(true);
	});

	test("recognizes known node package wrappers", () => {
		expect(
			matchesProviderCommand(
				"node /usr/local/lib/node_modules/@google/gemini-cli/index.js",
				"gemini"
			)
		).toBe(true);
		expect(
			matchesProviderCommand("node /usr/local/lib/node_modules/@openai/codex/bin/codex.js", "codex")
		).toBe(true);
		expect(matchesProviderCommand("/Users/me/.claude/versions/2.1.0 --resume abc", "claude")).toBe(
			true
		);
	});

	test("rejects unrelated processes that only mention a provider name", () => {
		expect(matchesProviderCommand("vim codex-notes.md", "codex")).toBe(false);
		expect(matchesProviderCommand("bash -lc 'echo claude'", "claude")).toBe(false);
		expect(matchesProviderCommand("node server.js --label gemini", "gemini")).toBe(false);
	});

	test("recognizes an agent behind the dispatch script's bash group leader", () => {
		expect(
			matchesProviderProcessGroup(
				[
					"bash /tmp/ss-dispatch-123/launch.sh",
					"/Users/me/.local/bin/codex resume abc",
					"node /tmp/superiorswarm-mcp/server.mjs",
				],
				"codex"
			)
		).toBe(true);
		expect(
			matchesProviderProcessGroup(["bash /tmp/maintenance.sh", "node server.js"], "codex")
		).toBe(false);
	});
});
