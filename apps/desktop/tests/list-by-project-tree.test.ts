import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { getDb } from "../src/main/db";
import { orchestratorMembers, workspaces } from "../src/main/db/schema";
import { attachToOrchestrator } from "../src/main/services/orchestrator-membership";
import { reorderChildren, reorderTopLevel } from "../src/main/services/workspace-ordering";
import { listByProjectTree } from "../src/main/services/workspace-service";
import {
	seedCrossRepoOrchestrator,
	seedProject,
	seedWorkspace,
	setupTestDb,
	teardownTestDb,
} from "./helpers/db";

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
		expect(tree.orchestrators[0]?.workspace.id).toBe(orch);
		expect(tree.orchestrators[0]?.children.map((c) => c.id)).toEqual([c2, c1]);
		expect(tree.loose.map((w) => w.id)).toEqual([loose]);
	});

	test("review-type workspaces are filtered out", async () => {
		const p = await seedProject();
		await seedWorkspace(p, { name: "a", type: "review" });
		await seedWorkspace(p, { name: "b" });
		const tree = await listByProjectTree({ projectId: p });
		expect(tree.loose.map((w) => w.name)).toEqual(["b"]);
	});

	test("children of a demoted orchestrator fall back to loose", async () => {
		const p = await seedProject();
		const orch = await seedWorkspace(p, { name: "orch", isOrchestrator: true });
		const child = await seedWorkspace(p, { name: "child" });
		await attachToOrchestrator({ orchestratorId: orch, workspaceId: child });

		// Demote the orchestrator WITHOUT cleaning up join rows (simulates the historical bug).
		const db = getDb();
		db.update(workspaces).set({ isOrchestrator: false }).where(eq(workspaces.id, orch)).run();

		const tree = await listByProjectTree({ projectId: p });
		expect(tree.orchestrators).toEqual([]);
		expect(tree.loose.map((w) => w.id).sort()).toEqual([child, orch].sort());
	});

	test("orphaned per-repo member row is not misclassified as cross-repo membership", async () => {
		// ws has ONLY an orphaned per-repo row (orchestratorId points at a deleted workspace,
		// parentKind="workspace"). Under the old set-difference logic, this row would be
		// misidentified as a cross-repo membership because its orchestratorId is absent
		// from allOrchestratorIds. The new parentKind-based logic must ignore it.
		const p = await seedProject();
		const ws = await seedWorkspace(p, { name: "ws" });

		// Orphaned per-repo row: references a nonexistent orchestrator workspace.
		const orphanOrchId = `ws-deleted-${Date.now()}`;
		const db = getDb();
		db.insert(orchestratorMembers)
			.values({
				orchestratorId: orphanOrchId,
				workspaceId: ws,
				parentKind: "workspace",
				sortOrder: 0,
				createdAt: new Date(),
			})
			.run();

		const tree = await listByProjectTree({ projectId: p });

		// ws should appear as loose with no cross-repo orchestrator.
		expect(tree.orchestrators).toHaveLength(0);
		expect(tree.loose).toHaveLength(1);
		expect(tree.loose[0]?.id).toBe(ws);
		expect(tree.loose[0]?.crossRepoOrchestrator).toBeNull();
	});

	test("cross-repo membership still shows after orphaned per-repo row is present", async () => {
		// Same workspace has both an orphaned per-repo row AND a valid cross-repo membership.
		// The xro must still show; the orphan must not clobber or duplicate.
		const p = await seedProject();
		const xro = await seedCrossRepoOrchestrator({ name: "my-xro", projectIds: [p] });
		const ws = await seedWorkspace(p, { name: "ws" });

		const db = getDb();

		// Legitimate cross-repo membership.
		db.insert(orchestratorMembers)
			.values({
				orchestratorId: xro,
				workspaceId: ws,
				parentKind: "cross_repo",
				sortOrder: 0,
				createdAt: new Date(),
			})
			.run();

		// Orphaned per-repo row for the same workspace.
		const orphanOrchId = `ws-gone-${Date.now()}`;
		db.insert(orchestratorMembers)
			.values({
				orchestratorId: orphanOrchId,
				workspaceId: ws,
				parentKind: "workspace",
				sortOrder: 1,
				createdAt: new Date(),
			})
			.run();

		const tree = await listByProjectTree({ projectId: p });

		expect(tree.loose).toHaveLength(1);
		expect(tree.loose[0]?.id).toBe(ws);
		expect(tree.loose[0]?.crossRepoOrchestrator?.id).toBe(xro);
		expect(tree.loose[0]?.crossRepoOrchestrator?.name).toBe("my-xro");
	});
});
