import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { asc, eq } from "drizzle-orm";
import { getDb } from "../src/main/db";
import { orchestratorMembers, workspaces } from "../src/main/db/schema";
import { attachToOrchestrator } from "../src/main/services/orchestrator-membership";
import { reorderChildren, reorderTopLevel } from "../src/main/services/workspace-ordering";
import { seedProject, seedWorkspace, setupTestDb, teardownTestDb } from "./helpers/db";

describe("workspace-ordering", () => {
	beforeEach(() => setupTestDb());
	afterEach(() => teardownTestDb());

	test("reorderTopLevel rewrites sortOrder to dense 0..N-1", async () => {
		const projectId = await seedProject();
		const a = await seedWorkspace(projectId, { name: "a" });
		const b = await seedWorkspace(projectId, { name: "b" });
		const c = await seedWorkspace(projectId, { name: "c" });

		await reorderTopLevel({ projectId, orderedIds: [c, a, b] });

		const rows = getDb()
			.select({ id: workspaces.id, sortOrder: workspaces.sortOrder })
			.from(workspaces)
			.where(eq(workspaces.projectId, projectId))
			.orderBy(asc(workspaces.sortOrder))
			.all();
		expect(rows.map((r) => r.id)).toEqual([c, a, b]);
		expect(rows.map((r) => r.sortOrder)).toEqual([0, 1, 2]);
	});

	test("reorderChildren rewrites orchestrator_members.sortOrder", async () => {
		const projectId = await seedProject();
		const orch = await seedWorkspace(projectId, { name: "orch", isOrchestrator: true });
		const x = await seedWorkspace(projectId, { name: "x" });
		const y = await seedWorkspace(projectId, { name: "y" });
		await attachToOrchestrator({ orchestratorId: orch, workspaceId: x });
		await attachToOrchestrator({ orchestratorId: orch, workspaceId: y });

		await reorderChildren({ orchestratorId: orch, orderedIds: [y, x] });

		const rows = getDb()
			.select({
				workspaceId: orchestratorMembers.workspaceId,
				sortOrder: orchestratorMembers.sortOrder,
			})
			.from(orchestratorMembers)
			.where(eq(orchestratorMembers.orchestratorId, orch))
			.orderBy(asc(orchestratorMembers.sortOrder))
			.all();
		expect(rows.map((r) => r.workspaceId)).toEqual([y, x]);
		expect(rows.map((r) => r.sortOrder)).toEqual([0, 1]);
	});

	test("reorderTopLevel throws when orderedIds contains an id not in the project", async () => {
		const projectId = await seedProject();
		const a = await seedWorkspace(projectId, { name: "a" });
		await expect(reorderTopLevel({ projectId, orderedIds: [a, "ws-foreign"] })).rejects.toThrow(
			/cross-project|unknown/i
		);
	});
});
