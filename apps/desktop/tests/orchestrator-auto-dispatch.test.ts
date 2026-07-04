import "./preload-electron-mock";
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { startControlPlane } from "../src/main/control-plane";
import { getDb, schema } from "../src/main/db";
import {
	getOrchestratorAutoDispatch,
	setOrchestratorAutoDispatch,
} from "../src/main/services/orchestrator-dispatch-policy";
import {
	seedCrossRepoOrchestrator,
	seedExternalManager,
	seedProject,
	seedWorkspace,
	setupTestDb,
} from "./helpers/db";

let TMP: string;
let PROJECT_ID: string;
let server: Awaited<ReturnType<typeof startControlPlane>>;
let confirmCalls: number;
let confirmAnswer: boolean;

const url = (p: string) => `http://127.0.0.1:${server.port}${p}`;

beforeAll(() => {
	setupTestDb();
});

beforeEach(async () => {
	TMP = mkdtempSync(join(tmpdir(), "auto-dispatch-"));
	confirmCalls = 0;
	confirmAnswer = true;
	setOrchestratorAutoDispatch(false);

	PROJECT_ID = `proj-${nanoid(8)}`;
	const now = new Date();
	getDb()
		.insert(schema.projects)
		.values({
			id: PROJECT_ID,
			name: "auto-dispatch-project",
			repoPath: TMP,
			defaultBranch: "main",
			createdAt: now,
			updatedAt: now,
		})
		.run();

	server = await startControlPlane({
		confirm: async () => {
			confirmCalls++;
			return confirmAnswer;
		},
		spawnFn: async () => ({ sessionId: "s", terminalId: "t" }),
	});
});

afterEach(async () => {
	await server.stop();
	setOrchestratorAutoDispatch(false);
	getDb().delete(schema.projects).where(eq(schema.projects.id, PROJECT_ID)).run();
	rmSync(TMP, { recursive: true, force: true });
});

async function dispatchAs(headers: Record<string, string>, workspaceId: string) {
	return fetch(url("/workspaces.dispatch"), {
		method: "POST",
		headers: {
			Authorization: `Bearer ${server.token}`,
			"Content-Type": "application/json",
			...headers,
		},
		body: JSON.stringify({ projectId: PROJECT_ID, workspaceId, prompt: "task" }),
	});
}

describe("orchestrator auto-dispatch setting", () => {
	test("setting persists as a boolean", () => {
		expect(getOrchestratorAutoDispatch()).toBe(false);
		setOrchestratorAutoDispatch(true);
		expect(getOrchestratorAutoDispatch()).toBe(true);
	});

	test("off: orchestrator dispatch consults the modal", async () => {
		const orch = await seedWorkspace(PROJECT_ID, { name: "orch", isOrchestrator: true });
		const child = await seedWorkspace(PROJECT_ID, { name: "child-off" });

		const res = await dispatchAs({ "X-Workspace-Id": orch }, child);
		expect(res.status).toBe(200);
		expect(confirmCalls).toBe(1);
	});

	test("on: orchestrator workspace dispatches without the modal", async () => {
		setOrchestratorAutoDispatch(true);
		const orch = await seedWorkspace(PROJECT_ID, { name: "orch2", isOrchestrator: true });
		const child = await seedWorkspace(PROJECT_ID, { name: "child-on" });
		confirmAnswer = false; // would cancel if consulted

		const res = await dispatchAs({ "X-Workspace-Id": orch }, child);
		expect(res.status).toBe(200);
		expect(confirmCalls).toBe(0);
	});

	test("on: non-orchestrator workspace caller still consults the modal", async () => {
		setOrchestratorAutoDispatch(true);
		const plain = await seedWorkspace(PROJECT_ID, { name: "plain" });
		const child = await seedWorkspace(PROJECT_ID, { name: "child-plain" });

		const res = await dispatchAs({ "X-Workspace-Id": plain }, child);
		expect(res.status).toBe(200);
		expect(confirmCalls).toBe(1);
	});

	test("on: cross-repo coordinator dispatches without the modal", async () => {
		setOrchestratorAutoDispatch(true);
		const xro = await seedCrossRepoOrchestrator({ projectIds: [PROJECT_ID] });
		const child = await seedWorkspace(PROJECT_ID, { name: "child-xro" });
		confirmAnswer = false;

		const res = await dispatchAs({ "X-Cross-Repo-Orchestrator-Id": xro }, child);
		expect(res.status).toBe(200);
		expect(confirmCalls).toBe(0);
	});

	test("on: external manager with confirm policy STILL consults the modal", async () => {
		setOrchestratorAutoDispatch(true);
		const mgr = await seedExternalManager({
			projectIds: [PROJECT_ID],
			dispatchPolicy: "confirm",
		});
		const child = await seedWorkspace(PROJECT_ID, { name: "child-mgr" });
		confirmAnswer = false;

		const res = await dispatchAs(
			{ "X-Cross-Repo-Orchestrator-Id": mgr.id, "X-Manager-Token": mgr.token },
			child
		);
		expect(res.status).toBe(499);
		expect(confirmCalls).toBe(1);
	});
});
