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
		const b = await seedWorkspace(projectId, { name: "b" });
		// Replace b with a foreign id so completeness (2==2) passes but validation fails
		await expect(reorderTopLevel({ projectId, orderedIds: [a, "ws-foreign"] })).rejects.toThrow(
			/not.?found|unknown|forbidden|cross-project/i
		);
		void b; // seeded so total count matches orderedIds.length
	});

	test("reorderTopLevel throws when orderedIds is incomplete", async () => {
		const projectId = await seedProject();
		const a = await seedWorkspace(projectId, { name: "a" });
		await seedWorkspace(projectId, { name: "b" });
		await expect(reorderTopLevel({ projectId, orderedIds: [a] })).rejects.toThrow(
			/must contain every|incomplete/i
		);
	});

	test("reorderTopLevel succeeds when project has review workspaces (excluded from total)", async () => {
		const projectId = await seedProject();
		const a = await seedWorkspace(projectId, { name: "a" });
		const b = await seedWorkspace(projectId, { name: "b" });
		await seedWorkspace(projectId, { name: "rev", type: "review" });
		// orderedIds only contains non-review workspaces — should succeed
		await expect(reorderTopLevel({ projectId, orderedIds: [b, a] })).resolves.toBeDefined();
	});

	test("reorderTopLevel excludes orchestrator children from completeness count", async () => {
		const projectId = await seedProject();
		// Seed: 1 orchestrator (top-level), 1 child (attached → not top-level),
		// 1 loose worktree (top-level). orderedIds should contain only orch + loose.
		const orchId = await seedWorkspace(projectId, { name: "orch", isOrchestrator: true });
		const childId = await seedWorkspace(projectId, { name: "child" });
		const looseId = await seedWorkspace(projectId, { name: "loose" });
		await attachToOrchestrator({ orchestratorId: orchId, workspaceId: childId });

		// Only orchestrator + loose are in the top-level zone
		await expect(reorderTopLevel({ projectId, orderedIds: [looseId, orchId] })).resolves.toEqual({
			ok: true,
		});
	});

	test("reorderTopLevel and reorderChildren do all reads inside the transaction", async () => {
		// Source-shape regression: both functions must perform validation reads
		// (count + found-id lookup) inside the same db.transaction block as their writes.
		// Prevents TOCTOU race with concurrent attach/detach.
		const src = await Bun.file(
			new URL("../src/main/services/workspace-ordering.ts", import.meta.url)
		).text();
		const txBlocks = src.match(/db\.transaction\(\(tx\) => \{[\s\S]*?\n\t\}\)/g) ?? [];
		// reorderTopLevel: tx block contains count() AND update(workspaces)
		expect(txBlocks.some((b) => b.includes("count()") && b.includes("update(workspaces)"))).toBe(
			true
		);
		// reorderChildren: tx block contains count() AND update(orchestratorMembers)
		expect(
			txBlocks.some((b) => b.includes("count()") && b.includes("update(orchestratorMembers)"))
		).toBe(true);
	});
});
