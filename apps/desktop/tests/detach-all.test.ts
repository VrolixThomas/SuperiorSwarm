import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	attachToOrchestrator,
	detachAllFromOrchestrator,
	listMembership,
} from "../src/main/services/orchestrator-membership";
import { seedProject, seedWorkspace, setupTestDb, teardownTestDb } from "./helpers/db";

describe("detachAllFromOrchestrator", () => {
	beforeEach(() => setupTestDb());
	afterEach(() => teardownTestDb());

	test("detaches all children of the given orchestrator", async () => {
		const p = await seedProject();
		const orch = await seedWorkspace(p, { name: "orch", isOrchestrator: true });
		const a = await seedWorkspace(p, { name: "a" });
		const b = await seedWorkspace(p, { name: "b" });
		await attachToOrchestrator({ orchestratorId: orch, workspaceId: a });
		await attachToOrchestrator({ orchestratorId: orch, workspaceId: b });

		const result = await detachAllFromOrchestrator({ orchestratorId: orch });

		expect(result.detachedCount).toBe(2);
		expect((await listMembership({ orchestratorId: orch })).length).toBe(0);
	});

	test("returns detachedCount=0 when orchestrator has no children", async () => {
		const p = await seedProject();
		const orch = await seedWorkspace(p, { name: "orch", isOrchestrator: true });
		const result = await detachAllFromOrchestrator({ orchestratorId: orch });
		expect(result.detachedCount).toBe(0);
	});

	test("leaves children of other orchestrators untouched", async () => {
		const p = await seedProject();
		const o1 = await seedWorkspace(p, { name: "o1", isOrchestrator: true });
		const o2 = await seedWorkspace(p, { name: "o2", isOrchestrator: true });
		const a = await seedWorkspace(p, { name: "a" });
		const b = await seedWorkspace(p, { name: "b" });
		await attachToOrchestrator({ orchestratorId: o1, workspaceId: a });
		await attachToOrchestrator({ orchestratorId: o2, workspaceId: b });

		await detachAllFromOrchestrator({ orchestratorId: o1 });

		expect((await listMembership({ orchestratorId: o1 })).length).toBe(0);
		expect((await listMembership({ orchestratorId: o2 })).map((m) => m.workspaceId)).toEqual([b]);
	});
});
