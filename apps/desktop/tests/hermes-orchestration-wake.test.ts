import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { EventBus } from "../src/main/control-plane/event-bus";
import { getDb, schema } from "../src/main/db";
import {
	type HermesOrchestrationWakeTarget,
	actionableHermesOrchestrationWorkspaceId,
	attachHermesOrchestrationWake,
	resolveHermesOrchestrationWakeTargets,
} from "../src/main/hermes/hermes-orchestration-wake";
import { admitHermesSession } from "../src/main/hermes/hermes-session-admissions";
import { linkHermesWorkspace } from "../src/main/hermes/hermes-workspace-links";
import { attachToCrossRepoOrchestrator } from "../src/main/services/cross-repo-orchestrator-membership";
import {
	seedExternalManager,
	seedProject,
	seedWorkspace,
	setupTestDb,
	teardownTestDb,
} from "./helpers/db";

describe("Hermes orchestration wake bridge", () => {
	beforeEach(() => setupTestDb());
	afterEach(() => teardownTestDb());

	test("routes only actionable owned-child events to the admitted canonical conversation", async () => {
		const projectId = await seedProject();
		const manager = await seedExternalManager({ projectIds: [projectId] });
		const workspaceId = await seedWorkspace(projectId, { name: "owned-child" });
		await attachToCrossRepoOrchestrator({ orchestratorId: manager.id, workspaceId });
		const now = new Date();
		getDb()
			.insert(schema.hermesConnections)
			.values({
				id: "connection-1",
				label: "Managed Hermes",
				baseUrl: "http://127.0.0.1:9000",
				profileId: "work",
				managerId: manager.id,
				managerBindingMode: "manual",
				managementMode: "managed",
				tokenStorage: "memory",
				createdAt: now,
				updatedAt: now,
			})
			.run();
		admitHermesSession({
			managerId: manager.id,
			metadata: {
				schemaVersion: 1,
				durableSessionId: "conversation-root",
				profileId: "work",
				sourcePlatform: "superiorswarm",
				isCron: false,
			},
			reason: "mcp",
		});
		linkHermesWorkspace({
			connectionId: "connection-1",
			profileId: "work",
			hermesSessionId: "conversation-root",
			hermesLineageRootId: "conversation-root",
			workspaceId,
			source: "tool-artifact",
		});

		expect(resolveHermesOrchestrationWakeTargets(workspaceId)).toEqual([
			{
				connectionId: "connection-1",
				managerId: manager.id,
				profileId: "work",
				lineageRootId: "conversation-root",
			},
		]);

		const enqueued: Array<HermesOrchestrationWakeTarget & { eventId: string; text: string }> = [];
		const bus = new EventBus();
		const detach = attachHermesOrchestrationWake(bus, {
			enqueue: async (input) => {
				enqueued.push(input);
			},
		});
		bus.emit(projectId, {
			event: "status",
			workspaceId,
			phase: "working",
			statusText: "still working",
			needs: null,
			ts: "now",
		});
		expect(enqueued).toEqual([]);

		bus.emit(projectId, {
			event: "status",
			workspaceId,
			phase: "blocked",
			statusText: "Need a decision",
			needs: "Choose A or B",
			ts: "later",
		});
		expect(enqueued).toHaveLength(1);
		expect(enqueued[0]).toMatchObject({
			connectionId: "connection-1",
			profileId: "work",
			lineageRootId: "conversation-root",
		});
		expect(enqueued[0]?.eventId).toMatch(/^[0-9a-f-]{36}$/);
		expect(enqueued[0]?.text).toContain("phase: blocked");
		expect(enqueued[0]?.text).toContain("needs: Choose A or B");
		detach();
	});

	test("fails closed for progress status and identifies child messages as actionable", () => {
		expect(
			actionableHermesOrchestrationWorkspaceId({
				event: "status",
				workspaceId: "child",
				phase: "working",
				statusText: null,
				needs: null,
				ts: "now",
			})
		).toBeNull();
		expect(
			actionableHermesOrchestrationWorkspaceId({
				event: "message",
				messageId: "message-1",
				from: "child",
				to: null,
				kind: "question",
				content: "What next?",
				ts: "now",
			})
		).toBe("child");
	});
});
