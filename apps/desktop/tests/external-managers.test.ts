import "./preload-electron-mock";
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import YAML from "yaml";
import { startControlPlane } from "../src/main/control-plane";
import { generateToken, hashToken, tokenMatchesHash } from "../src/main/control-plane/auth";
import {
	crossRepoEventsFilePath,
	setEventsDir,
} from "../src/main/control-plane/orchestrator-event-sink";
import { getDb, schema } from "../src/main/db";
import { listCrossRepoOrchestrators } from "../src/main/services/cross-repo-orchestrators";
import {
	createExternalManager,
	deleteExternalManager,
	installIntoHermesConfig,
	listExternalManagers,
	regenerateExternalManagerToken,
	renameExternalManager,
	uninstallFromHermesConfig,
} from "../src/main/services/external-managers";
import { mergeYamlKey, removeYamlKey } from "../src/main/services/yaml-merge";
import { seedExternalManager, seedProject, seedWorkspace, setupTestDb } from "./helpers/db";

beforeAll(() => {
	setupTestDb();
});

describe("manager token hashing", () => {
	test("hashToken is deterministic 64-char hex", () => {
		const t = generateToken();
		expect(hashToken(t)).toBe(hashToken(t));
		expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
	});

	test("tokenMatchesHash accepts correct token, rejects wrong/null", () => {
		const t = generateToken();
		const h = hashToken(t);
		expect(tokenMatchesHash(t, h)).toBe(true);
		expect(tokenMatchesHash(generateToken(), h)).toBe(false);
		expect(tokenMatchesHash(t, null)).toBe(false);
	});
});

describe("external manager control-plane access", () => {
	let TMP: string;
	let PROJECT_ID: string;
	let server: Awaited<ReturnType<typeof startControlPlane>>;
	let confirmCalls: number;
	let confirmAnswer: boolean;

	const url = (p: string) => `http://127.0.0.1:${server.port}${p}`;
	const authMgr = (id: string, token: string) => ({
		Authorization: `Bearer ${server.token}`,
		"X-Cross-Repo-Orchestrator-Id": id,
		"X-Manager-Token": token,
	});

	beforeEach(async () => {
		TMP = mkdtempSync(join(tmpdir(), "extmgr-"));
		setEventsDir(join(TMP, "events"));
		confirmCalls = 0;
		confirmAnswer = true;

		PROJECT_ID = `proj-${nanoid(8)}`;
		const now = new Date();
		getDb()
			.insert(schema.projects)
			.values({
				id: PROJECT_ID,
				name: "ext-mgr-project",
				repoPath: TMP, // existing dir so dispatch cwd checks pass
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
		getDb().delete(schema.projects).where(eq(schema.projects.id, PROJECT_ID)).run();
		rmSync(TMP, { recursive: true, force: true });
	});

	test("context.resolve with valid managerToken returns external-manager mode", async () => {
		const mgr = await seedExternalManager({ projectIds: [PROJECT_ID] });
		const res = await fetch(url("/context.resolve?cwd=/nowhere"), {
			headers: { Authorization: `Bearer ${server.token}`, "X-Manager-Token": mgr.token },
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			mode: string;
			crossRepoOrchestratorId: string;
			linkedProjectIds: string[];
		};
		expect(body.mode).toBe("external-manager");
		expect(body.crossRepoOrchestratorId).toBe(mgr.id);
		expect(body.linkedProjectIds).toEqual([PROJECT_ID]);

		// lastSeenAt was stamped
		const row = getDb()
			.select({ lastSeenAt: schema.crossRepoOrchestrators.lastSeenAt })
			.from(schema.crossRepoOrchestrators)
			.where(eq(schema.crossRepoOrchestrators.id, mgr.id))
			.get();
		expect(row?.lastSeenAt).not.toBeNull();
	});

	test("context.resolve with unknown managerToken returns 401", async () => {
		const res = await fetch(url("/context.resolve?cwd=/nowhere"), {
			headers: { Authorization: `Bearer ${server.token}`, "X-Manager-Token": generateToken() },
		});
		expect(res.status).toBe(401);
	});

	test("context.resolve prefers a task token over a manager token", async () => {
		// A task launch that inherited SUPERIORSWARM_MANAGER_TOKEN must resolve
		// as its task, not as the external manager.
		const mgr = await seedExternalManager({ projectIds: [PROJECT_ID] });
		const taskToken = generateToken();
		server.taskRegistry.register(taskToken, {
			mode: "review",
			projectId: PROJECT_ID,
			workspaceId: "ws-task",
			modeContext: {},
		});
		const res = await fetch(url(`/context.resolve?cwd=/nowhere&taskToken=${taskToken}`), {
			headers: { Authorization: `Bearer ${server.token}`, "X-Manager-Token": mgr.token },
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { mode: string };
		expect(body.mode).toBe("review");
	});

	test("context.resolve by cwd never matches an external manager workDir", async () => {
		const mgr = await seedExternalManager({ projectIds: [PROJECT_ID] });
		const workDir = getDb()
			.select({ workDir: schema.crossRepoOrchestrators.workDir })
			.from(schema.crossRepoOrchestrators)
			.where(eq(schema.crossRepoOrchestrators.id, mgr.id))
			.get()?.workDir as string;
		const res = await fetch(url(`/context.resolve?cwd=${encodeURIComponent(workDir)}`), {
			headers: { Authorization: `Bearer ${server.token}` },
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { mode: string };
		expect(body.mode).toBe("none");
	});

	test("external caller without X-Manager-Token is rejected", async () => {
		const mgr = await seedExternalManager({ projectIds: [PROJECT_ID] });
		const res = await fetch(url("/projects.list"), {
			headers: {
				Authorization: `Bearer ${server.token}`,
				"X-Cross-Repo-Orchestrator-Id": mgr.id,
			},
		});
		expect(res.status).toBe(401);
	});

	test("external caller with wrong X-Manager-Token is rejected", async () => {
		const mgr = await seedExternalManager({ projectIds: [PROJECT_ID] });
		const res = await fetch(url("/projects.list"), {
			headers: authMgr(mgr.id, generateToken()),
		});
		expect(res.status).toBe(401);
	});

	test("projects.list returns only linked projects", async () => {
		const otherProject = await seedProject();
		const mgr = await seedExternalManager({ projectIds: [PROJECT_ID] });
		const res = await fetch(url("/projects.list"), { headers: authMgr(mgr.id, mgr.token) });
		expect(res.status).toBe(200);
		const body = (await res.json()) as { projects: Array<{ id: string }> };
		expect(body.projects.map((p) => p.id)).toEqual([PROJECT_ID]);
		expect(body.projects.map((p) => p.id)).not.toContain(otherProject);
	});

	test("all-scope manager lists current and future projects and can operate on both", async () => {
		const currentProject = await seedProject();
		const mgr = await seedExternalManager({
			accessScope: "all",
			dispatchPolicy: "auto",
		});

		const first = await fetch(url("/projects.list"), { headers: authMgr(mgr.id, mgr.token) });
		expect(first.status).toBe(200);
		const firstBody = (await first.json()) as { projects: Array<{ id: string }> };
		expect(firstBody.projects.map((project) => project.id)).toContain(PROJECT_ID);
		expect(firstBody.projects.map((project) => project.id)).toContain(currentProject);

		const futureProject = await seedProject();
		const futureRepo = join(TMP, "future-repo");
		mkdirSync(futureRepo, { recursive: true });
		getDb()
			.update(schema.projects)
			.set({ repoPath: futureRepo })
			.where(eq(schema.projects.id, futureProject))
			.run();
		const futureWorkspace = await seedWorkspace(futureProject, { name: "future-child" });
		const second = await fetch(url("/projects.list"), { headers: authMgr(mgr.id, mgr.token) });
		expect(second.status).toBe(200);
		const secondBody = (await second.json()) as { projects: Array<{ id: string }> };
		expect(secondBody.projects.map((project) => project.id)).toContain(futureProject);

		const get = await fetch(url(`/workspaces.get?workspaceId=${futureWorkspace}`), {
			headers: authMgr(mgr.id, mgr.token),
		});
		expect(get.status).toBe(200);

		const dispatch = await fetch(url("/workspaces.dispatch"), {
			method: "POST",
			headers: { ...authMgr(mgr.id, mgr.token), "Content-Type": "application/json" },
			body: JSON.stringify({ workspaceId: futureWorkspace, prompt: "future project task" }),
		});
		expect(dispatch.status).toBe(200);
		expect(confirmCalls).toBe(0);
		const membership = getDb()
			.select({ orchestratorId: schema.orchestratorMembers.orchestratorId })
			.from(schema.orchestratorMembers)
			.where(eq(schema.orchestratorMembers.workspaceId, futureWorkspace))
			.get();
		expect(membership?.orchestratorId).toBe(mgr.id);
		expect(
			getDb()
				.select()
				.from(schema.crossRepoOrchestratorProjects)
				.where(eq(schema.crossRepoOrchestratorProjects.orchestratorId, mgr.id))
				.all()
		).toHaveLength(0);
	});

	test("events.poll returns events after cursor and advances nextSeq", async () => {
		const mgr = await seedExternalManager({ projectIds: [PROJECT_ID] });
		const file = crossRepoEventsFilePath(mgr.id);
		mkdirSync(join(TMP, "events", "cross-repo"), { recursive: true });
		appendFileSync(file, `${JSON.stringify({ event: "status", phase: "working" })}\n`);
		appendFileSync(file, `${JSON.stringify({ event: "status", phase: "done" })}\n`);

		const res = await fetch(url("/events.poll?afterSeq=0&waitMs=0"), {
			headers: authMgr(mgr.id, mgr.token),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { events: Array<{ phase: string }>; nextSeq: number };
		expect(body.nextSeq).toBe(2);
		expect(body.events.map((e) => e.phase)).toEqual(["working", "done"]);

		const res2 = await fetch(url("/events.poll?afterSeq=2&waitMs=0"), {
			headers: authMgr(mgr.id, mgr.token),
		});
		const body2 = (await res2.json()) as { events: unknown[]; nextSeq: number };
		expect(body2.events).toEqual([]);
		expect(body2.nextSeq).toBe(2);
	});

	test("events.poll resets cursor when the file shrank", async () => {
		const mgr = await seedExternalManager({ projectIds: [PROJECT_ID] });
		const file = crossRepoEventsFilePath(mgr.id);
		mkdirSync(join(TMP, "events", "cross-repo"), { recursive: true });
		appendFileSync(file, `${JSON.stringify({ event: "status", phase: "working" })}\n`);

		const res = await fetch(url("/events.poll?afterSeq=10&waitMs=0"), {
			headers: authMgr(mgr.id, mgr.token),
		});
		const body = (await res.json()) as { events: unknown[]; nextSeq: number };
		expect(body.nextSeq).toBe(1);
		expect(body.events.length).toBe(1);
	});

	test("events.poll delivers events appended while the poll is waiting", async () => {
		const mgr = await seedExternalManager({ projectIds: [PROJECT_ID] });
		const file = crossRepoEventsFilePath(mgr.id);
		mkdirSync(join(TMP, "events", "cross-repo"), { recursive: true });
		appendFileSync(file, `${JSON.stringify({ event: "status", phase: "working" })}\n`);

		const pending = fetch(url("/events.poll?afterSeq=1&waitMs=3000"), {
			headers: authMgr(mgr.id, mgr.token),
		});
		await new Promise((r) => setTimeout(r, 700));
		appendFileSync(file, `${JSON.stringify({ event: "status", phase: "done" })}\n`);
		const res = await pending;
		const body = (await res.json()) as { events: Array<{ phase: string }>; nextSeq: number };
		expect(body.nextSeq).toBe(2);
		expect(body.events.map((e) => e.phase)).toEqual(["done"]);
	});

	test("workspaces.agent_output returns ANSI-stripped scrollback tail", async () => {
		const mgr = await seedExternalManager({ projectIds: [PROJECT_ID] });
		const wsId = await seedWorkspace(PROJECT_ID, { name: "child" });
		getDb()
			.insert(schema.terminalSessions)
			.values({
				id: `term-${nanoid(6)}`,
				workspaceId: wsId,
				title: "Agent session",
				cwd: TMP,
				scrollback: "line1\n\u001b[31mred line\u001b[0m\nline3",
				sortOrder: 0,
				updatedAt: new Date(),
			})
			.run();

		const res = await fetch(url(`/workspaces.agent_output?workspaceId=${wsId}&lines=2`), {
			headers: authMgr(mgr.id, mgr.token),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { output: string | null; capturedAt: string | null };
		expect(body.output).toBe("red line\nline3");
		expect(body.capturedAt).not.toBeNull();
	});

	test("workspaces.agent_output returns null when no scrollback exists", async () => {
		const mgr = await seedExternalManager({ projectIds: [PROJECT_ID] });
		const wsId = await seedWorkspace(PROJECT_ID, { name: "silent" });
		const res = await fetch(url(`/workspaces.agent_output?workspaceId=${wsId}`), {
			headers: authMgr(mgr.id, mgr.token),
		});
		const body = (await res.json()) as { output: string | null };
		expect(body.output).toBeNull();
	});

	test("dispatch with policy=auto skips the confirm modal", async () => {
		const mgr = await seedExternalManager({
			projectIds: [PROJECT_ID],
			dispatchPolicy: "auto",
		});
		const wsId = await seedWorkspace(PROJECT_ID, { name: "auto-child" });
		confirmAnswer = false; // would cancel if consulted

		const res = await fetch(url("/workspaces.dispatch"), {
			method: "POST",
			headers: { ...authMgr(mgr.id, mgr.token), "Content-Type": "application/json" },
			body: JSON.stringify({ workspaceId: wsId, prompt: "do the thing" }),
		});
		expect(res.status).toBe(200);
		expect(confirmCalls).toBe(0);
	});

	test("dispatch with policy=confirm still consults the modal", async () => {
		const mgr = await seedExternalManager({
			projectIds: [PROJECT_ID],
			dispatchPolicy: "confirm",
		});
		const wsId = await seedWorkspace(PROJECT_ID, { name: "confirm-child" });
		confirmAnswer = false;

		const res = await fetch(url("/workspaces.dispatch"), {
			method: "POST",
			headers: { ...authMgr(mgr.id, mgr.token), "Content-Type": "application/json" },
			body: JSON.stringify({ workspaceId: wsId, prompt: "do the thing" }),
		});
		expect(res.status).toBe(499);
		expect(confirmCalls).toBe(1);
	});

	test("remove_worktree is never auto-approved", async () => {
		const mgr = await seedExternalManager({
			projectIds: [PROJECT_ID],
			dispatchPolicy: "auto",
		});
		const wsId = await seedWorkspace(PROJECT_ID, { name: "rm-child" });
		confirmAnswer = false;

		const res = await fetch(url("/workspaces.remove"), {
			method: "POST",
			headers: { ...authMgr(mgr.id, mgr.token), "Content-Type": "application/json" },
			body: JSON.stringify({ workspaceId: wsId }),
		});
		expect(res.status).toBe(499);
		expect(confirmCalls).toBe(1);
	});
});

describe("external manager service CRUD", () => {
	test("mutations refuse workspace-kind orchestrator ids", async () => {
		// Manager ids share cross_repo_orchestrators with in-app coordinators;
		// the external-manager mutations must never touch a workspace-kind row.
		const id = `xro-${nanoid(8)}`;
		const now = new Date();
		getDb()
			.insert(schema.crossRepoOrchestrators)
			.values({
				id,
				name: "real coordinator",
				workDir: `/tmp/xro-${id}`,
				agentKind: "claude",
				status: "idle",
				sortOrder: 0,
				kind: "workspace",
				createdAt: now,
				updatedAt: now,
			})
			.run();

		expect(renameExternalManager({ id, name: "nope" })).rejects.toThrow();
		expect(regenerateExternalManagerToken({ id })).rejects.toThrow();
		await deleteExternalManager({ id }); // must be a no-op, not a teardown
		const survivor = getDb()
			.select({ id: schema.crossRepoOrchestrators.id })
			.from(schema.crossRepoOrchestrators)
			.where(eq(schema.crossRepoOrchestrators.id, id))
			.get();
		expect(survivor?.id).toBe(id);
		getDb()
			.delete(schema.crossRepoOrchestrators)
			.where(eq(schema.crossRepoOrchestrators.id, id))
			.run();
	});

	test("create → token authenticates, list hides hash, regenerate rotates, delete removes", async () => {
		const projectId = await seedProject();
		const created = await createExternalManager({
			name: "Hermes",
			projectIds: [projectId],
			dispatchPolicy: "auto",
		});
		expect(created.id).toStartWith("mgr-");

		const row = getDb()
			.select()
			.from(schema.crossRepoOrchestrators)
			.where(eq(schema.crossRepoOrchestrators.id, created.id))
			.get();
		expect(row?.kind).toBe("external");
		expect(row?.dispatchPolicy).toBe("auto");
		expect(row?.accessScope).toBe("selected");
		expect(tokenMatchesHash(created.token, row?.tokenHash ?? null)).toBe(true);

		const listed = await listExternalManagers();
		const mine = listed.find((m) => m.id === created.id);
		expect(mine?.linkedProjectIds).toEqual([projectId]);
		expect(Object.keys(mine ?? {})).not.toContain("tokenHash");

		// External managers must not appear in the coordinator (xro) list.
		const xros = await listCrossRepoOrchestrators();
		expect(xros.map((x) => x.id)).not.toContain(created.id);

		const { token: newToken } = await regenerateExternalManagerToken({ id: created.id });
		const rotated = getDb()
			.select({ tokenHash: schema.crossRepoOrchestrators.tokenHash })
			.from(schema.crossRepoOrchestrators)
			.where(eq(schema.crossRepoOrchestrators.id, created.id))
			.get();
		expect(tokenMatchesHash(created.token, rotated?.tokenHash ?? null)).toBe(false);
		expect(tokenMatchesHash(newToken, rotated?.tokenHash ?? null)).toBe(true);

		await deleteExternalManager({ id: created.id });
		const gone = getDb()
			.select({ id: schema.crossRepoOrchestrators.id })
			.from(schema.crossRepoOrchestrators)
			.where(eq(schema.crossRepoOrchestrators.id, created.id))
			.get();
		expect(gone).toBeUndefined();
	});

	test("all-project access is explicit while selected remains the safe default", async () => {
		const selected = await createExternalManager({ name: "Restricted", projectIds: [] });
		const broad = await createExternalManager({
			name: "Installation manager",
			projectIds: [],
			accessScope: "all",
		});

		const listed = await listExternalManagers();
		expect(listed.find((manager) => manager.id === selected.id)?.accessScope).toBe("selected");
		expect(listed.find((manager) => manager.id === broad.id)?.accessScope).toBe("all");

		await deleteExternalManager({ id: selected.id });
		await deleteExternalManager({ id: broad.id });
	});
});

describe("yaml merge + hermes config install", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "yaml-"));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	test("mergeYamlKey creates file and nests keys; removeYamlKey deletes", () => {
		const file = join(dir, "config.yaml");
		mergeYamlKey(file, ["mcp_servers", "superiorswarm"], { command: "/bin/x" });
		const parsed = YAML.parse(readFileSync(file, "utf-8"));
		expect(parsed.mcp_servers.superiorswarm.command).toBe("/bin/x");

		removeYamlKey(file, ["mcp_servers", "superiorswarm"]);
		const after = YAML.parse(readFileSync(file, "utf-8"));
		expect(after.mcp_servers?.superiorswarm).toBeUndefined();
	});

	test("mergeYamlKey preserves unrelated keys", () => {
		const file = join(dir, "config.yaml");
		mergeYamlKey(file, ["model"], "hermes-4");
		mergeYamlKey(file, ["mcp_servers", "superiorswarm"], { command: "/bin/x" });
		const parsed = YAML.parse(readFileSync(file, "utf-8"));
		expect(parsed.model).toBe("hermes-4");
		expect(parsed.mcp_servers.superiorswarm.command).toBe("/bin/x");
	});

	test("mergeYamlKey preserves comments and anchors in a hand-written config", () => {
		const file = join(dir, "config.yaml");
		writeFileSync(
			file,
			["# my hermes config", "defaults: &d", "  temp: 0.5", "run: *d", "model: hermes-4", ""].join(
				"\n"
			)
		);
		mergeYamlKey(file, ["mcp_servers", "superiorswarm"], { command: "/bin/x" });
		const raw = readFileSync(file, "utf-8");
		expect(raw).toContain("# my hermes config");
		expect(raw).toContain("&d");
		expect(raw).toContain("*d");
		expect(YAML.parse(raw).mcp_servers.superiorswarm.command).toBe("/bin/x");

		removeYamlKey(file, ["mcp_servers", "superiorswarm"]);
		expect(readFileSync(file, "utf-8")).toContain("# my hermes config");
	});

	test("mergeYamlKey treats a comments-only file as an empty mapping", () => {
		const file = join(dir, "config.yaml");
		writeFileSync(file, "# just a comment\n");
		mergeYamlKey(file, ["mcp_servers", "superiorswarm"], { command: "/bin/x" });
		const raw = readFileSync(file, "utf-8");
		expect(YAML.parse(raw).mcp_servers.superiorswarm.command).toBe("/bin/x");
	});

	test("installIntoHermesConfig writes launcher command and token env", () => {
		const file = join(dir, "config.yaml");
		const token = generateToken();
		const { configPath } = installIntoHermesConfig({
			managerToken: token,
			configPath: file,
			userDataDir: dir,
		});
		expect(configPath).toBe(file);
		expect(existsSync(file)).toBe(true);
		const parsed = YAML.parse(readFileSync(file, "utf-8"));
		const entry = parsed.mcp_servers.superiorswarm;
		expect(entry.command).toContain("superiorswarm-mcp");
		expect(entry.env.SUPERIORSWARM_MANAGER_TOKEN).toBe(token);

		uninstallFromHermesConfig({ configPath: file });
		const after = YAML.parse(readFileSync(file, "utf-8"));
		expect(after.mcp_servers?.superiorswarm).toBeUndefined();
	});
});
