import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { getDb } from "../src/main/db";
import { workspaces } from "../src/main/db/schema";
import {
	addProjectToCrossRepoOrchestrator,
	attachToCrossRepoOrchestrator,
	detachFromCrossRepoOrchestrator,
	listCrossRepoMembers,
	removeProjectFromCrossRepoOrchestrator,
} from "../src/main/services/cross-repo-orchestrator-membership";
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
});
