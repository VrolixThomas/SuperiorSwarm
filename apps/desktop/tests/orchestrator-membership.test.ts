import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	attachToOrchestrator,
	detachFromOrchestrator,
	listMembership,
} from "../src/main/services/orchestrator-membership";
import { seedProject, seedWorkspace, setupTestDb, teardownTestDb } from "./helpers/db";

describe("orchestrator-membership", () => {
	beforeEach(() => setupTestDb());
	afterEach(() => teardownTestDb());

	test("attach creates a member row at end of orchestrator's sortOrder", async () => {
		const p = await seedProject();
		const orch = await seedWorkspace(p, { name: "orch", isOrchestrator: true });
		const a = await seedWorkspace(p, { name: "a" });
		const b = await seedWorkspace(p, { name: "b" });

		await attachToOrchestrator({ orchestratorId: orch, workspaceId: a });
		await attachToOrchestrator({ orchestratorId: orch, workspaceId: b });

		const members = await listMembership({ orchestratorId: orch });
		expect(members.map((m) => m.workspaceId)).toEqual([a, b]);
		expect(members.map((m) => m.sortOrder)).toEqual([0, 1]);
	});

	test("attach moves membership when worktree is already in another orchestrator (V1 single-parent)", async () => {
		const p = await seedProject();
		const orch1 = await seedWorkspace(p, { name: "o1", isOrchestrator: true });
		const orch2 = await seedWorkspace(p, { name: "o2", isOrchestrator: true });
		const x = await seedWorkspace(p, { name: "x" });

		await attachToOrchestrator({ orchestratorId: orch1, workspaceId: x });
		await attachToOrchestrator({ orchestratorId: orch2, workspaceId: x });

		expect((await listMembership({ orchestratorId: orch1 })).length).toBe(0);
		expect((await listMembership({ orchestratorId: orch2 })).map((m) => m.workspaceId)).toEqual([
			x,
		]);
	});

	test("detach removes the member row", async () => {
		const p = await seedProject();
		const orch = await seedWorkspace(p, { name: "orch", isOrchestrator: true });
		const a = await seedWorkspace(p, { name: "a" });
		await attachToOrchestrator({ orchestratorId: orch, workspaceId: a });
		await detachFromOrchestrator({ workspaceId: a });
		expect((await listMembership({ orchestratorId: orch })).length).toBe(0);
	});

	test("attach rejects when parent is not flagged isOrchestrator", async () => {
		const p = await seedProject();
		const notOrch = await seedWorkspace(p, { name: "no", isOrchestrator: false });
		const a = await seedWorkspace(p, { name: "a" });
		await expect(attachToOrchestrator({ orchestratorId: notOrch, workspaceId: a })).rejects.toThrow(
			/not.*orchestrator/i
		);
	});

	test("attach rejects when worktree is in different project", async () => {
		const p1 = await seedProject();
		const p2 = await seedProject();
		const orch = await seedWorkspace(p1, { name: "orch", isOrchestrator: true });
		const a = await seedWorkspace(p2, { name: "a" });
		await expect(attachToOrchestrator({ orchestratorId: orch, workspaceId: a })).rejects.toThrow(
			/different project|cross-project/i
		);
	});

	test("attach rejects attaching an orchestrator to another orchestrator", async () => {
		const p = await seedProject();
		const o1 = await seedWorkspace(p, { name: "o1", isOrchestrator: true });
		const o2 = await seedWorkspace(p, { name: "o2", isOrchestrator: true });
		await expect(attachToOrchestrator({ orchestratorId: o1, workspaceId: o2 })).rejects.toThrow(
			/cannot nest|orchestrator/i
		);
	});

	test("attach rejects when orchestratorId does not exist", async () => {
		const p = await seedProject();
		const a = await seedWorkspace(p, { name: "a" });
		await expect(
			attachToOrchestrator({ orchestratorId: "ws-nonexistent", workspaceId: a })
		).rejects.toThrow(/not.?found|unknown/i);
	});

	test("attach rejects when workspaceId does not exist", async () => {
		const p = await seedProject();
		const orch = await seedWorkspace(p, { name: "orch", isOrchestrator: true });
		await expect(
			attachToOrchestrator({ orchestratorId: orch, workspaceId: "ws-nonexistent" })
		).rejects.toThrow(/not.?found|unknown/i);
	});
});
