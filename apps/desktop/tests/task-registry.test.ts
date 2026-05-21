import { describe, expect, test } from "bun:test";
import { TaskRegistry } from "../src/main/control-plane/task-registry";

describe("TaskRegistry", () => {
	test("register then consume returns the registration", () => {
		const r = new TaskRegistry();
		r.register("tok", {
			mode: "review",
			projectId: "p",
			workspaceId: "w",
			modeContext: { reviewDraftId: "d", dbPath: "/db" },
		});
		const out = r.consume("tok");
		expect(out?.mode).toBe("review");
		expect(out?.modeContext?.reviewDraftId).toBe("d");
	});

	test("consume is single-use", () => {
		const r = new TaskRegistry();
		r.register("tok", { mode: "solve", projectId: "p", workspaceId: "w", modeContext: {} });
		r.consume("tok");
		expect(r.consume("tok")).toBeNull();
	});

	test("consume returns null for unknown token", () => {
		const r = new TaskRegistry();
		expect(r.consume("nope")).toBeNull();
	});

	test("entries past TTL are not returned", () => {
		const now = { v: 0 };
		const r = new TaskRegistry({ ttlMs: 1000, now: () => now.v });
		r.register("tok", { mode: "review", projectId: "p", workspaceId: "w", modeContext: {} });
		now.v = 1500;
		expect(r.consume("tok")).toBeNull();
	});
});
