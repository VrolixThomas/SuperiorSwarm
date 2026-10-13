import "./preload-electron-mock";
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { type McpContext, resolveContext } from "../mcp-standalone/context.mjs";
import { startControlPlane } from "../src/main/control-plane";
import { setEventsDir } from "../src/main/control-plane/orchestrator-event-sink";
import { getDb, schema } from "../src/main/db";
import { setOrchestratorAutoDispatch } from "../src/main/services/orchestrator-dispatch-policy";
import type { SpawnArgs } from "../src/main/services/workspace-service";
import { seedCrossRepoOrchestrator, seedExternalManager, setupTestDb } from "./helpers/db";

let root: string;
let folder: string;
let projectId: string;
let orchestratorId: string;
let coordinatorIds: string[];
let confirmCalls: number;
let spawns: SpawnArgs[];
let server: Awaited<ReturnType<typeof startControlPlane>>;

function addFolderWorkspace(
	name: string,
	folderPath: string | null = null,
	isOrchestrator = false
) {
	const id = nanoid();
	const now = new Date();
	getDb()
		.insert(schema.workspaces)
		.values({
			id,
			projectId,
			name,
			type: "folder",
			folderPath,
			isOrchestrator,
			createdAt: now,
			updatedAt: now,
		})
		.run();
	return id;
}

function context(env: Record<string, string> = {}, cwd = folder) {
	return resolveContext(server, { cwd, env });
}

function request(caller: McpContext, path: string, body?: Record<string, unknown>) {
	if (!caller.workspaceId) throw new Error("Expected workspace context");
	return fetch(`http://127.0.0.1:${server.port}${path}`, {
		method: body ? "POST" : "GET",
		headers: {
			Authorization: `Bearer ${server.token}`,
			"X-Workspace-Id": caller.workspaceId,
			"Content-Type": "application/json",
		},
		body: body ? JSON.stringify(body) : undefined,
	});
}

beforeAll(setupTestDb);

beforeEach(async () => {
	root = mkdtempSync(join(tmpdir(), "folder-mcp-"));
	folder = join(root, "Werk");
	mkdirSync(folder);
	setEventsDir(join(root, "events"));
	projectId = nanoid();
	coordinatorIds = [];
	confirmCalls = 0;
	spawns = [];
	setOrchestratorAutoDispatch(false);
	const now = new Date();
	getDb()
		.insert(schema.projects)
		.values({
			id: projectId,
			name: "Werk",
			kind: "folder",
			repoPath: folder,
			defaultBranch: "main",
			createdAt: now,
			updatedAt: now,
		})
		.run();
	orchestratorId = addFolderWorkspace("default", null, true);
	server = await startControlPlane({
		confirm: async () => {
			confirmCalls++;
			return false;
		},
		spawnFn: async (args) => {
			spawns.push(args);
			return { sessionId: "session", terminalId: "terminal" };
		},
	});
});

afterEach(async () => {
	await server.stop();
	setOrchestratorAutoDispatch(false);
	getDb().delete(schema.projects).where(eq(schema.projects.id, projectId)).run();
	for (const id of coordinatorIds) {
		getDb()
			.delete(schema.crossRepoOrchestrators)
			.where(eq(schema.crossRepoOrchestrators.id, id))
			.run();
	}
	rmSync(root, { recursive: true, force: true });
});

describe("folder MCP context", () => {
	test("discovers a folder orchestrator and its event stream by project path", async () => {
		expect(await context()).toMatchObject({
			mode: "workspace-agent",
			projectId,
			workspaceId: orchestratorId,
			isOrchestrator: true,
			orchestratorEventsPath: join(root, "events", `${projectId}.jsonl`),
		});
	});

	test("discovers a custom folder path through a symlink without inheriting the root role", async () => {
		const childPath = join(folder, "child");
		mkdirSync(childPath);
		const childId = addFolderWorkspace("child", childPath);
		const alias = join(root, "alias");
		symlinkSync(childPath, alias, "dir");
		const child = await context({}, alias);
		expect(child).toMatchObject({
			mode: "workspace-agent",
			workspaceId: childId,
			isOrchestrator: false,
		});
		expect(child.orchestratorEventsPath).toBeUndefined();
	});

	test("refuses to guess an orchestrator when folder tabs share a cwd", async () => {
		addFolderWorkspace("child");
		await expect(context()).rejects.toThrow("Multiple folder workspaces share this directory");
	});

	test("terminal identity distinguishes folder tabs and survives cwd changes", async () => {
		const childId = addFolderWorkspace("child");
		const cwd = join(folder, "elsewhere");
		mkdirSync(cwd);
		expect(await context({ AGENT_NOTIFY_WORKSPACE_ID: orchestratorId }, cwd)).toMatchObject({
			workspaceId: orchestratorId,
			isOrchestrator: true,
		});
		expect(await context({ AGENT_NOTIFY_WORKSPACE_ID: childId })).toMatchObject({
			workspaceId: childId,
			isOrchestrator: false,
		});
	});

	test("a stale terminal identity cannot fall back to a folder orchestrator", async () => {
		await expect(context({ AGENT_NOTIFY_WORKSPACE_ID: "deleted-workspace" })).rejects.toThrow(
			"The terminal's workspace no longer exists"
		);
	});

	test("explicit folder identity wins over an overlapping registered worktree", async () => {
		const now = new Date();
		const worktreeId = nanoid();
		const workspaceId = nanoid();
		getDb()
			.insert(schema.worktrees)
			.values({
				id: worktreeId,
				projectId,
				path: folder,
				branch: "feature",
				baseBranch: "main",
				createdAt: now,
				updatedAt: now,
			})
			.run();
		getDb()
			.insert(schema.workspaces)
			.values({
				id: workspaceId,
				projectId,
				worktreeId,
				type: "worktree",
				name: "feature",
				createdAt: now,
				updatedAt: now,
			})
			.run();
		expect(await context()).toMatchObject({ workspaceId, isOrchestrator: false });
		expect(await context({ AGENT_NOTIFY_WORKSPACE_ID: orchestratorId })).toMatchObject({
			workspaceId: orchestratorId,
			isOrchestrator: true,
		});
	});

	test("coordinator terminal IDs still resolve as cross-repo orchestrators", async () => {
		const id = await seedCrossRepoOrchestrator({ projectIds: [projectId] });
		coordinatorIds.push(id);
		expect(await context({ AGENT_NOTIFY_WORKSPACE_ID: id })).toMatchObject({
			mode: "cross-repo-orchestrator",
			crossRepoOrchestratorId: id,
			linkedProjectIds: [projectId],
		});
	});

	test("an external manager ID cannot authenticate as a terminal workspace", async () => {
		const manager = await seedExternalManager({ projectIds: [projectId] });
		coordinatorIds.push(manager.id);
		await expect(context({ AGENT_NOTIFY_WORKSPACE_ID: manager.id })).rejects.toThrow("401");
		expect(
			await context({
				AGENT_NOTIFY_WORKSPACE_ID: orchestratorId,
				SUPERIORSWARM_MANAGER_TOKEN: manager.token,
			})
		).toMatchObject({ mode: "external-manager", crossRepoOrchestratorId: manager.id });
	});

	test("task identity takes precedence over inherited terminal and manager environments", async () => {
		server.taskRegistry.register("folder-review", {
			mode: "review",
			projectId,
			workspaceId: "review-workspace",
			modeContext: { reviewDraftId: "draft" },
		});
		expect(
			await context({
				AGENT_NOTIFY_WORKSPACE_ID: orchestratorId,
				SUPERIORSWARM_MANAGER_TOKEN: "inherited-manager-token",
				SUPERIORSWARM_TASK_TOKEN: "folder-review",
			})
		).toMatchObject({ mode: "review", workspaceId: "review-workspace" });
	});

	test.each([
		{ auto: true, orchestrator: true, status: 200, confirmations: 0 },
		{ auto: false, orchestrator: true, status: 499, confirmations: 1 },
		{ auto: true, orchestrator: false, status: 499, confirmations: 1 },
	])("folder dispatch respects auto=$auto and orchestrator=$orchestrator", async (scenario) => {
		setOrchestratorAutoDispatch(scenario.auto);
		const childId = addFolderWorkspace("child");
		const caller = await context({
			AGENT_NOTIFY_WORKSPACE_ID: scenario.orchestrator ? orchestratorId : childId,
		});
		const res = await request(caller, "/workspaces.dispatch", {
			workspaceId: childId,
			prompt: "task",
		});
		expect(res.status).toBe(scenario.status);
		expect(confirmCalls).toBe(scenario.confirmations);
		if (scenario.status === 200) {
			expect(spawns).toHaveLength(1);
			expect(spawns[0]).toMatchObject({ workspaceId: childId, cwd: folder });
		} else {
			expect(spawns).toHaveLength(0);
		}
	});

	test("folder agents can list, inspect, publish status, and message within their project", async () => {
		const childId = addFolderWorkspace("child");
		const caller = await context({ AGENT_NOTIFY_WORKSPACE_ID: childId });
		const list = await request(caller, `/workspaces.list?projectId=${projectId}`);
		expect((await list.json()).workspaces.map((ws: { id: string }) => ws.id).sort()).toEqual(
			[orchestratorId, childId].sort()
		);
		const detail = await request(caller, `/workspaces.get?workspaceId=${childId}`);
		expect(await detail.json()).toMatchObject({ id: childId, type: "folder", path: folder });
		const status = await request(caller, "/workspaces.set_status", { phase: "working" });
		expect(status.status).toBe(200);
		expect(
			getDb().select().from(schema.workspaces).where(eq(schema.workspaces.id, childId)).get()
				?.currentPhase
		).toBe("working");
		const message = await request(caller, "/workspaces.send_message", {
			toWorkspaceId: orchestratorId,
			kind: "note",
			content: "Folder agent ready",
		});
		expect(message.status).toBe(200);
		const orchestrator = await context({ AGENT_NOTIFY_WORKSPACE_ID: orchestratorId });
		const inbox = await request(orchestrator, `/workspaces.read_messages?projectId=${projectId}`);
		expect((await inbox.json()).messages).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ fromWorkspaceId: childId, content: "Folder agent ready" }),
			])
		);
	});

	test("folder identity does not grant access to another project", async () => {
		const caller = await context({ AGENT_NOTIFY_WORKSPACE_ID: orchestratorId });
		const res = await request(caller, "/workspaces.list?projectId=another-project");
		expect(res.status).toBe(401);
	});
});
