import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "../src/main/db";
import { orchestratorMembers, workspaces, worktrees } from "../src/main/db/schema";
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

	test("rolls back promote + attaches when an attach mid-loop fails", async () => {
		const projectId = await seedProject();
		const ok1 = await seedWorkspace(projectId, { name: "ok-1" });
		const ok2 = await seedWorkspace(projectId, { name: "ok-2" });

		let calls = 0;
		const failingAttach = async () => {
			calls++;
			if (calls === 2) throw new Error("simulated attach failure");
			return { ok: true as const };
		};

		await expect(
			createOrchestrator(
				{
					projectId,
					name: "test-orch",
					baseBranch: "main",
					attachWorkspaceIds: [ok1, ok2],
				},
				{ createWorkspaceFn: fakeCreateWorkspace, attachFn: failingAttach }
			)
		).rejects.toThrow(/simulated attach failure/);

		// Assert rollback: no orchestrator promotion persists in this project.
		const orchRows = getDb()
			.select()
			.from(workspaces)
			.where(eq(workspaces.projectId, projectId))
			.all();
		const promoted = orchRows.filter((r) => r.isOrchestrator);
		expect(promoted.length).toBe(0);

		// And no member rows reference the would-be orchestrator's attach targets.
		const memberRows = getDb().select().from(orchestratorMembers).all();
		const scopedMemberRows = memberRows.filter((r) => [ok1, ok2].includes(r.workspaceId));
		expect(scopedMemberRows.length).toBe(0);
	});

	test("dedupes attachWorkspaceIds", async () => {
		const projectId = await seedProject();
		const a = await seedWorkspace(projectId, { name: "child-a" });

		const result = await createOrchestrator(
			{
				projectId,
				name: "test-orch-dedupe",
				baseBranch: "main",
				attachWorkspaceIds: [a, a, a],
			},
			{ createWorkspaceFn: fakeCreateWorkspace }
		);
		expect(result.isOrchestrator).toBe(true);

		const rows = getDb()
			.select()
			.from(orchestratorMembers)
			.where(eq(orchestratorMembers.orchestratorId, result.id))
			.all();
		expect(rows.length).toBe(1);
	});
});
