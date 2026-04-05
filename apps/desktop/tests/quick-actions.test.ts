import { describe, expect, test } from "bun:test";

describe("quickActions schema", () => {
	test("quickActions table has the expected columns", async () => {
		const { quickActions } = await import("../src/main/db/schema");
		const columns = Object.keys(quickActions);
		expect(columns).toContain("id");
		expect(columns).toContain("projectId");
		expect(columns).toContain("label");
		expect(columns).toContain("command");
		expect(columns).toContain("cwd");
		expect(columns).toContain("shortcut");
		expect(columns).toContain("sortOrder");
		expect(columns).toContain("createdAt");
		expect(columns).toContain("updatedAt");
	});
});
