import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "../src/main/db";
import {
	crossRepoOrchestrators,
	orchestratorMembers,
	workspaces,
	worktrees,
} from "../src/main/db/schema";
import {
	addProjectToCrossRepoOrchestrator,
	attachToCrossRepoOrchestrator,
	detachFromCrossRepoOrchestrator,
	listCrossRepoMembers,
	removeProjectFromCrossRepoOrchestrator,
} from "../src/main/services/cross-repo-orchestrator-membership";
import { deleteCrossRepoOrchestrator } from "../src/main/services/cross-repo-orchestrators";
import {
	seedCrossRepoOrchestrator,
	seedProject,
	seedWorkspace,
	setupTestDb,
	teardownTestDb,
} from "./helpers/db";

describe("cross-repo-orchestrator-membership", () => {
	beforeEach(() => setupTestDb());
	afterEach(() => teardownTestDb());

	test("attach succeeds when workspace's project is in the linked-projects list", async () => {
		const p1 = await seedProject();
		const p2 = await seedProject();
		const xro = await seedCrossRepoOrchestrator({ projectIds: [p1, p2] });
		const wsA = await seedWorkspace(p1, { name: "a" });
		const wsB = await seedWorkspace(p2, { name: "b" });

		await attachToCrossRepoOrchestrator({ orchestratorId: xro, workspaceId: wsA });
		await attachToCrossRepoOrchestrator({ orchestratorId: xro, workspaceId: wsB });

		const members = await listCrossRepoMembers({ orchestratorId: xro });
		expect(members.map((m) => m.workspaceId).sort()).toEqual([wsA, wsB].sort());
		expect(members.every((m) => m.parentKind === "cross_repo")).toBe(true);
	});

	test("attach rejects when workspace's project is not linked", async () => {
		const linked = await seedProject();
		const unlinked = await seedProject();
		const xro = await seedCrossRepoOrchestrator({ projectIds: [linked] });
		const ws = await seedWorkspace(unlinked, { name: "x" });

		await expect(
			attachToCrossRepoOrchestrator({ orchestratorId: xro, workspaceId: ws })
		).rejects.toThrow(/not linked|project.*not.*member/i);
	});

	test("attach removes existing per-repo orchestrator membership (single-parent)", async () => {
		const p = await seedProject();
		const xro = await seedCrossRepoOrchestrator({ projectIds: [p] });
		const perRepo = await seedWorkspace(p, { name: "orch", isOrchestrator: true });
		const ws = await seedWorkspace(p, { name: "a" });

		const { attachToOrchestrator } = await import("../src/main/services/orchestrator-membership");
		await attachToOrchestrator({ orchestratorId: perRepo, workspaceId: ws });

		await attachToCrossRepoOrchestrator({ orchestratorId: xro, workspaceId: ws });

		const xroMembers = await listCrossRepoMembers({ orchestratorId: xro });
		expect(xroMembers.map((m) => m.workspaceId)).toEqual([ws]);

		const { listMembership } = await import("../src/main/services/orchestrator-membership");
		const perRepoMembers = await listMembership({ orchestratorId: perRepo });
		expect(perRepoMembers.length).toBe(0);
	});

	test("detach removes the membership row", async () => {
		const p = await seedProject();
		const xro = await seedCrossRepoOrchestrator({ projectIds: [p] });
		const ws = await seedWorkspace(p, { name: "a" });
		await attachToCrossRepoOrchestrator({ orchestratorId: xro, workspaceId: ws });
		await detachFromCrossRepoOrchestrator({ workspaceId: ws });
		expect((await listCrossRepoMembers({ orchestratorId: xro })).length).toBe(0);
	});

	test("addProject succeeds and appends to linked-projects list", async () => {
		const p1 = await seedProject();
		const p2 = await seedProject();
		const xro = await seedCrossRepoOrchestrator({ projectIds: [p1] });
		await addProjectToCrossRepoOrchestrator({ orchestratorId: xro, projectId: p2 });

		const ws = await seedWorkspace(p2, { name: "in-new-project" });
		await attachToCrossRepoOrchestrator({ orchestratorId: xro, workspaceId: ws });
		expect((await listCrossRepoMembers({ orchestratorId: xro })).length).toBe(1);
	});

	test("removeProject cascades — detaches all members from that project", async () => {
		const p1 = await seedProject();
		const p2 = await seedProject();
		const xro = await seedCrossRepoOrchestrator({ projectIds: [p1, p2] });
		const wsP1 = await seedWorkspace(p1, { name: "in-p1" });
		const wsP2 = await seedWorkspace(p2, { name: "in-p2" });

		await attachToCrossRepoOrchestrator({ orchestratorId: xro, workspaceId: wsP1 });
		await attachToCrossRepoOrchestrator({ orchestratorId: xro, workspaceId: wsP2 });

		await removeProjectFromCrossRepoOrchestrator({ orchestratorId: xro, projectId: p1 });

		const members = await listCrossRepoMembers({ orchestratorId: xro });
		expect(members.map((m) => m.workspaceId)).toEqual([wsP2]);
	});

	test("listCrossRepoMembers returns live status fields from workspaces table", async () => {
		const p = await seedProject();
		const xro = await seedCrossRepoOrchestrator({ projectIds: [p] });
		const ws = await seedWorkspace(p, { name: "blocked-ws" });

		await attachToCrossRepoOrchestrator({ orchestratorId: xro, workspaceId: ws });

		// Directly update the workspace status fields (simulating setStatus)
		getDb()
			.update(workspaces)
			.set({
				currentPhase: "blocked",
				statusText: "waiting for review",
				needs: "decision on API design",
				updatedAt: new Date(),
			})
			.where(eq(workspaces.id, ws))
			.run();

		const members = await listCrossRepoMembers({ orchestratorId: xro });
		expect(members).toHaveLength(1);
		const member = members[0]!;
		expect(member.currentPhase).toBe("blocked");
		expect(member.statusText).toBe("waiting for review");
		expect(member.needs).toBe("decision on API design");
	});

	test("createdByDispatch defaults to false on plain attach and is true when set", async () => {
		const p = await seedProject();
		const xro = await seedCrossRepoOrchestrator({ projectIds: [p] });
		const wsPlain = await seedWorkspace(p, { name: "plain" });
		const wsDispatched = await seedWorkspace(p, { name: "dispatched" });

		await attachToCrossRepoOrchestrator({ orchestratorId: xro, workspaceId: wsPlain });
		await attachToCrossRepoOrchestrator({
			orchestratorId: xro,
			workspaceId: wsDispatched,
			createdByDispatch: true,
		});

		const readFlag = (workspaceId: string) =>
			getDb()
				.select({ createdByDispatch: orchestratorMembers.createdByDispatch })
				.from(orchestratorMembers)
				.where(
					and(
						eq(orchestratorMembers.orchestratorId, xro),
						eq(orchestratorMembers.workspaceId, workspaceId)
					)
				)
				.get();

		expect(readFlag(wsPlain)?.createdByDispatch).toBe(false);
		expect(readFlag(wsDispatched)?.createdByDispatch).toBe(true);
	});

	test("listCrossRepoMembers returns createdByDispatch per member", async () => {
		const p = await seedProject();
		const xro = await seedCrossRepoOrchestrator({ projectIds: [p] });
		const wsPlain = await seedWorkspace(p, { name: "plain" });
		const wsDispatched = await seedWorkspace(p, { name: "dispatched" });
		await attachToCrossRepoOrchestrator({ orchestratorId: xro, workspaceId: wsPlain });
		await attachToCrossRepoOrchestrator({
			orchestratorId: xro,
			workspaceId: wsDispatched,
			createdByDispatch: true,
		});

		const members = await listCrossRepoMembers({ orchestratorId: xro });
		const byId = new Map(members.map((m) => [m.workspaceId, m]));
		expect(byId.get(wsPlain)?.createdByDispatch).toBe(false);
		expect(byId.get(wsDispatched)?.createdByDispatch).toBe(true);
	});

	test("delete with removeWorkspaces removes only dispatched workspaces", async () => {
		const p = await seedProject();
		const xro = await seedCrossRepoOrchestrator({ projectIds: [p] });
		const now = new Date();

		// Dispatched member: worktree row + worktree-type workspace with a path that
		// does NOT exist on disk, so removeWorkspace deletes DB rows only.
		const worktreeId = `wt-${nanoid(8)}`;
		const dispatchedWsId = `ws-dispatched-${nanoid(8)}`;
		getDb()
			.insert(worktrees)
			.values({
				id: worktreeId,
				projectId: p,
				path: `/tmp/does-not-exist-${worktreeId}`,
				branch: "feat/x",
				baseBranch: "main",
				createdAt: now,
				updatedAt: now,
			})
			.run();
		getDb()
			.insert(workspaces)
			.values({
				id: dispatchedWsId,
				projectId: p,
				type: "worktree",
				name: "feat/x",
				worktreeId,
				currentPhase: "idle",
				isOrchestrator: false,
				sortOrder: 0,
				createdAt: now,
				updatedAt: now,
			})
			.run();
		await attachToCrossRepoOrchestrator({
			orchestratorId: xro,
			workspaceId: dispatchedWsId,
			createdByDispatch: true,
		});

		// Plain attached member (not created by this orchestrator).
		const attachedWsId = await seedWorkspace(p, { name: "attached" });
		await attachToCrossRepoOrchestrator({ orchestratorId: xro, workspaceId: attachedWsId });

		await deleteCrossRepoOrchestrator({ id: xro, removeWorkspaces: true });

		const dispatchedRow = getDb()
			.select({ id: workspaces.id })
			.from(workspaces)
			.where(eq(workspaces.id, dispatchedWsId))
			.get();
		const worktreeRow = getDb()
			.select({ id: worktrees.id })
			.from(worktrees)
			.where(eq(worktrees.id, worktreeId))
			.get();
		const attachedRow = getDb()
			.select({ id: workspaces.id })
			.from(workspaces)
			.where(eq(workspaces.id, attachedWsId))
			.get();

		expect(dispatchedRow).toBeUndefined();
		expect(worktreeRow).toBeUndefined();
		expect(attachedRow?.id).toBe(attachedWsId);

		const xroRow = getDb()
			.select({ id: crossRepoOrchestrators.id })
			.from(crossRepoOrchestrators)
			.where(eq(crossRepoOrchestrators.id, xro))
			.get();
		expect(xroRow).toBeUndefined();
	});

	test("re-attach preserves createdByDispatch=true (dispatch must not downgrade)", async () => {
		const p = await seedProject();
		const xro = await seedCrossRepoOrchestrator({ projectIds: [p] });
		const ws = await seedWorkspace(p, { name: "child" });

		// create_worktree path stamps true...
		await attachToCrossRepoOrchestrator({
			orchestratorId: xro,
			workspaceId: ws,
			createdByDispatch: true,
		});
		// ...then a later dispatch re-attaches WITHOUT the flag.
		await attachToCrossRepoOrchestrator({ orchestratorId: xro, workspaceId: ws });

		const members = await listCrossRepoMembers({ orchestratorId: xro });
		expect(members.find((m) => m.workspaceId === ws)?.createdByDispatch).toBe(true);
	});

	test("createdByDispatch does not leak to a different orchestrator", async () => {
		const p = await seedProject();
		const xroA = await seedCrossRepoOrchestrator({ projectIds: [p] });
		const xroB = await seedCrossRepoOrchestrator({ projectIds: [p] });
		const ws = await seedWorkspace(p, { name: "leak-check" });

		await attachToCrossRepoOrchestrator({
			orchestratorId: xroA,
			workspaceId: ws,
			createdByDispatch: true,
		});
		await attachToCrossRepoOrchestrator({ orchestratorId: xroB, workspaceId: ws });

		const members = await listCrossRepoMembers({ orchestratorId: xroB });
		expect(members.find((m) => m.workspaceId === ws)?.createdByDispatch).toBe(false);
	});

	test("delete without removeWorkspaces keeps all workspaces", async () => {
		const p = await seedProject();
		const xro = await seedCrossRepoOrchestrator({ projectIds: [p] });
		const ws = await seedWorkspace(p, { name: "keep" });
		await attachToCrossRepoOrchestrator({
			orchestratorId: xro,
			workspaceId: ws,
			createdByDispatch: true,
		});

		await deleteCrossRepoOrchestrator({ id: xro });

		const row = getDb()
			.select({ id: workspaces.id })
			.from(workspaces)
			.where(eq(workspaces.id, ws))
			.get();
		expect(row?.id).toBe(ws);
	});
});
