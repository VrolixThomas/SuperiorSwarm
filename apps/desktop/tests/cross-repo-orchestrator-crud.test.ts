import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	createCrossRepoOrchestrator,
	deleteCrossRepoOrchestrator,
	getCrossRepoOrchestrator,
	listCrossRepoOrchestrators,
	renameCrossRepoOrchestrator,
} from "../src/main/services/cross-repo-orchestrators";
import { setupTestDb, teardownTestDb } from "./helpers/db";

describe("cross-repo-orchestrators CRUD", () => {
	beforeEach(() => setupTestDb());
	afterEach(() => teardownTestDb());

	test("create returns id with xro- prefix and persists row", async () => {
		const id = await createCrossRepoOrchestrator({
			name: "Auth migration",
			agentKind: "claude",
		});
		expect(id).toMatch(/^xro-/);
		const row = await getCrossRepoOrchestrator({ id });
		expect(row?.name).toBe("Auth migration");
		expect(row?.agentKind).toBe("claude");
		expect(row?.status).toBe("idle");
		expect(row?.workDir).toContain(id);
	});

	test("list returns rows ordered by sortOrder asc", async () => {
		const a = await createCrossRepoOrchestrator({ name: "a", agentKind: "claude" });
		const b = await createCrossRepoOrchestrator({ name: "b", agentKind: "claude" });
		const all = await listCrossRepoOrchestrators();
		expect(all.map((r) => r.id)).toEqual([a, b]);
	});

	test("rename updates name and updatedAt", async () => {
		const id = await createCrossRepoOrchestrator({ name: "old", agentKind: "claude" });
		const before = (await getCrossRepoOrchestrator({ id }))!;
		await new Promise((r) => setTimeout(r, 1100));
		await renameCrossRepoOrchestrator({ id, name: "new" });
		const after = (await getCrossRepoOrchestrator({ id }))!;
		expect(after.name).toBe("new");
		expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
	});

	test("delete removes the row", async () => {
		const id = await createCrossRepoOrchestrator({ name: "doomed", agentKind: "claude" });
		await deleteCrossRepoOrchestrator({ id });
		expect(await getCrossRepoOrchestrator({ id })).toBeUndefined();
	});
});
