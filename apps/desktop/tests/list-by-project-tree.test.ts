import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { setupTestDb, teardownTestDb, seedProject, seedWorkspace } from "./helpers/db";
import { listByProjectTree } from "../src/main/services/workspace-service";
import { attachToOrchestrator } from "../src/main/services/orchestrator-membership";
import { reorderTopLevel, reorderChildren } from "../src/main/services/workspace-ordering";

describe("listByProjectTree", () => {
	beforeEach(() => setupTestDb());
	afterEach(() => teardownTestDb());

	test("empty project returns empty arrays", async () => {
		const p = await seedProject();
		const tree = await listByProjectTree({ projectId: p });
		expect(tree.orchestrators).toEqual([]);
		expect(tree.loose).toEqual([]);
	});

	test("loose-only project returns all in loose, ordered by sortOrder", async () => {
		const p = await seedProject();
		const a = await seedWorkspace(p, { name: "a" });
		const b = await seedWorkspace(p, { name: "b" });
		await reorderTopLevel({ projectId: p, orderedIds: [b, a] });
		const tree = await listByProjectTree({ projectId: p });
		expect(tree.orchestrators).toEqual([]);
		expect(tree.loose.map((w) => w.id)).toEqual([b, a]);
	});

	test("orchestrators with children: children attached do not appear in loose", async () => {
		const p = await seedProject();
		const orch = await seedWorkspace(p, { name: "orch", isOrchestrator: true });
		const c1 = await seedWorkspace(p, { name: "c1" });
		const c2 = await seedWorkspace(p, { name: "c2" });
		const loose = await seedWorkspace(p, { name: "loose" });

		await attachToOrchestrator({ orchestratorId: orch, workspaceId: c1 });
		await attachToOrchestrator({ orchestratorId: orch, workspaceId: c2 });
		await reorderChildren({ orchestratorId: orch, orderedIds: [c2, c1] });

		const tree = await listByProjectTree({ projectId: p });
		expect(tree.orchestrators).toHaveLength(1);
		expect(tree.orchestrators[0].workspace.id).toBe(orch);
		expect(tree.orchestrators[0].children.map((c) => c.id)).toEqual([c2, c1]);
		expect(tree.loose.map((w) => w.id)).toEqual([loose]);
	});

	test("review-type workspaces are filtered out", async () => {
		const p = await seedProject();
		await seedWorkspace(p, { name: "a", type: "review" });
		await seedWorkspace(p, { name: "b" });
		const tree = await listByProjectTree({ projectId: p });
		expect(tree.loose.map((w) => w.name)).toEqual(["b"]);
	});
});
