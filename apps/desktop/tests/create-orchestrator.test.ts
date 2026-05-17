import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "../src/main/db";
import { workspaces, worktrees } from "../src/main/db/schema";
import { listMembership } from "../src/main/services/orchestrator-membership";
import { createOrchestrator } from "../src/main/services/workspace-service";
import { seedProject, seedWorkspace, setupTestDb, teardownTestDb } from "./helpers/db";

// Fake createWorkspace that inserts the DB rows directly, skipping git.
function fakeCreateWorkspace(input: { projectId: string; branch: string; baseBranch?: string }) {
	const workspaceId = `ws-${nanoid(8)}`;
	const worktreeId = `wt-${nanoid(8)}`;
	const now = new Date();
	const db = getDb();
	db.insert(worktrees)
		.values({
			id: worktreeId,
			projectId: input.projectId,
			path: `/tmp/fake-${workspaceId}`,
			branch: input.branch,
			baseBranch: input.baseBranch ?? "main",
			createdAt: now,
			updatedAt: now,
		})
		.run();
	db.insert(workspaces)
		.values({
			id: workspaceId,
			projectId: input.projectId,
			type: "worktree",
			name: input.branch,
			currentPhase: "idle",
			isOrchestrator: false,
			sortOrder: 0,
			worktreeId,
			terminalId: null,
			createdAt: now,
			updatedAt: now,
		})
		.run();
	return Promise.resolve({
		workspaceId,
		worktreeId,
		createdAt: now,
		updatedAt: now,
	});
}

describe("createOrchestrator", () => {
	beforeEach(() => setupTestDb());
	afterEach(() => teardownTestDb());

	test("creates a workspace flagged as orchestrator", async () => {
		const p = await seedProject();
		const result = await createOrchestrator(
			{ projectId: p, name: "auth-orch", baseBranch: "main", attachWorkspaceIds: [] },
			{ createWorkspaceFn: fakeCreateWorkspace }
		);
		const row = getDb().select().from(workspaces).where(eq(workspaces.id, result.id)).get();
		expect(row?.isOrchestrator).toBe(true);
		expect(row?.name).toBe("auth-orch");
	});

	test("attaches listed loose worktrees in order", async () => {
		const p = await seedProject();
		const a = await seedWorkspace(p, { name: "a" });
		const b = await seedWorkspace(p, { name: "b" });

		const result = await createOrchestrator(
			{ projectId: p, name: "orch", baseBranch: "main", attachWorkspaceIds: [a, b] },
			{ createWorkspaceFn: fakeCreateWorkspace }
		);

		const members = await listMembership({ orchestratorId: result.id });
		expect(members.map((m) => m.workspaceId)).toEqual([a, b]);
	});

	test("rejects attach of a workspace from another project, leaving no partial state", async () => {
		const p1 = await seedProject();
		const p2 = await seedProject();
		const foreign = await seedWorkspace(p2, { name: "foreign" });

		await expect(
			createOrchestrator(
				{ projectId: p1, name: "orch", baseBranch: "main", attachWorkspaceIds: [foreign] },
				{ createWorkspaceFn: fakeCreateWorkspace }
			)
		).rejects.toThrow(/different project/i);

		const p1Workspaces = getDb()
			.select()
			.from(workspaces)
			.where(eq(workspaces.projectId, p1))
			.all();
		expect(p1Workspaces.length).toBe(0);
	});
});
