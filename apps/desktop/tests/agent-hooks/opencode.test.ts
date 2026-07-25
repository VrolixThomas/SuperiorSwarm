import { describe, expect, test } from "bun:test";
import { buildOpenCodePluginSource } from "../../src/main/agent-hooks/agents/opencode";

describe("OpenCode lifecycle plugin", () => {
	test("generates valid JavaScript with authenticated per-session events", () => {
		const source = buildOpenCodePluginSource(4567, "local-secret");
		const transpiler = new Bun.Transpiler({ loader: "js" });

		expect(() => transpiler.transformSync(source)).not.toThrow();
		expect(source).toContain('const TOKEN = "local-secret"');
		expect(source).toContain("Authorization: `Bearer ${TOKEN}`");
		expect(source).toContain("providerSessionId: sessionID");
		expect(source).toContain("const states = new Map()");
		expect(source).toContain("cwd: directory || process.cwd()");
	});
});
