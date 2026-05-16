import "./preload-electron-mock";
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { nanoid } from "nanoid";
import simpleGit from "simple-git";
import { startControlPlane } from "../src/main/control-plane";
import { getDb, schema } from "../src/main/db";
import { initRepo } from "../src/main/git/operations";

let TMP: string;
let REPO: string;
let PROJECT_ID: string;
let server: Awaited<ReturnType<typeof startControlPlane>>;

beforeAll(() => {
	const db = getDb();
	migrate(db, { migrationsFolder: join(import.meta.dir, "../src/main/db/migrations") });
});

beforeEach(async () => {
	TMP = mkdtempSync(join(tmpdir(), "cp-"));
	REPO = join(TMP, "repo");
	mkdirSync(REPO, { recursive: true });
	await initRepo(REPO, "main");
	await simpleGit(REPO).raw(["commit", "--allow-empty", "-m", "init"]);

	PROJECT_ID = `proj-${nanoid(8)}`;
	const db = getDb();
	const now = new Date();
	db.insert(schema.projects)
		.values({
			id: PROJECT_ID,
			repoPath: REPO,
			name: "repo",
			defaultBranch: "main",
			createdAt: now,
			updatedAt: now,
		})
		.run();
	server = await startControlPlane({
		confirm: async () => true,
		spawnFn: async () => ({ sessionId: "s", terminalId: "t" }),
	});
});

afterEach(async () => {
	await server.stop();
	const db = getDb();
	db.delete(schema.projects).where(eq(schema.projects.id, PROJECT_ID)).run();
	rmSync(TMP, { recursive: true, force: true });
});

const url = (p: string) => `http://127.0.0.1:${server.port}${p}`;
const auth = () => ({ Authorization: `Bearer ${server.token}` });
const authWs = (wsId: string) => ({
	Authorization: `Bearer ${server.token}`,
	"X-Workspace-Id": wsId,
});

describe("control-plane HTTP", () => {
	test("rejects missing token with 401", async () => {
		const res = await fetch(url(`/workspaces.list?projectId=${PROJECT_ID}`));
		expect(res.status).toBe(401);
	});

	test("rejects bad token with 401", async () => {
		const res = await fetch(url(`/workspaces.list?projectId=${PROJECT_ID}`), {
			headers: { Authorization: "Bearer wrong" },
		});
		expect(res.status).toBe(401);
	});

	test("returns 404 for unknown route", async () => {
		const res = await fetch(url("/nope"), { headers: auth() });
		expect(res.status).toBe(404);
	});

	test("create + list + get + remove round-trip", async () => {
		const create = await fetch(url("/workspaces.create"), {
			method: "POST",
			headers: { ...auth(), "Content-Type": "application/json" },
			body: JSON.stringify({ projectId: PROJECT_ID, branch: "feature/cp1" }),
		});
		expect(create.status).toBe(200);
		const created = (await create.json()) as { workspaceId: string; path: string };

		const list = await fetch(url(`/workspaces.list?projectId=${PROJECT_ID}`), { headers: auth() });
		const listed = (await list.json()) as { workspaces: Array<{ name: string }> };
		expect(listed.workspaces.map((w) => w.name)).toContain("feature/cp1");

		const get = await fetch(
			url(`/workspaces.get?projectId=${PROJECT_ID}&workspaceId=${created.workspaceId}`),
			{ headers: auth() }
		);
		expect(get.status).toBe(200);

		const rm = await fetch(url("/workspaces.remove"), {
			method: "POST",
			headers: { ...auth(), "Content-Type": "application/json" },
			body: JSON.stringify({ projectId: PROJECT_ID, workspaceId: created.workspaceId }),
		});
		const removed = (await rm.json()) as { status: string };
		expect(removed.status).toBe("removed");
	});

	test("403 on cross-project access", async () => {
		const create = await fetch(url("/workspaces.create"), {
			method: "POST",
			headers: { ...auth(), "Content-Type": "application/json" },
			body: JSON.stringify({ projectId: PROJECT_ID, branch: "feature/cp2" }),
		});
		const created = (await create.json()) as { workspaceId: string };

		const get = await fetch(
			url(`/workspaces.get?projectId=other&workspaceId=${created.workspaceId}`),
			{ headers: auth() }
		);
		expect(get.status).toBe(403);
	});

	test("400 on invalid body", async () => {
		const res = await fetch(url("/workspaces.create"), {
			method: "POST",
			headers: { ...auth(), "Content-Type": "application/json" },
			body: JSON.stringify({ projectId: PROJECT_ID }),
		});
		expect(res.status).toBe(400);
	});

	test("dispatch route returns started status", async () => {
		const create = await fetch(url("/workspaces.create"), {
			method: "POST",
			headers: { ...auth(), "Content-Type": "application/json" },
			body: JSON.stringify({ projectId: PROJECT_ID, branch: "feature/cp3" }),
		});
		const created = (await create.json()) as { workspaceId: string };

		const dispatch = await fetch(url("/workspaces.dispatch"), {
			method: "POST",
			headers: { ...auth(), "Content-Type": "application/json" },
			body: JSON.stringify({
				projectId: PROJECT_ID,
				workspaceId: created.workspaceId,
				prompt: "do thing",
				cliPreset: "claude",
			}),
		});
		const body = (await dispatch.json()) as { status: string };
		expect(body.status).toBe("started");
	});

	test("499 when confirm denies dispatch", async () => {
		await server.stop();
		server = await startControlPlane({
			confirm: async () => false,
			spawnFn: async () => ({ sessionId: "s", terminalId: "t" }),
		});

		const create = await fetch(url("/workspaces.create"), {
			method: "POST",
			headers: { ...auth(), "Content-Type": "application/json" },
			body: JSON.stringify({ projectId: PROJECT_ID, branch: "feature/cp-deny" }),
		});
		const created = (await create.json()) as { workspaceId: string };

		const dispatch = await fetch(url("/workspaces.dispatch"), {
			method: "POST",
			headers: { ...auth(), "Content-Type": "application/json" },
			body: JSON.stringify({
				projectId: PROJECT_ID,
				workspaceId: created.workspaceId,
				prompt: "x",
				cliPreset: "claude",
			}),
		});
		expect(dispatch.status).toBe(499);
		const body = (await dispatch.json()) as { error: string };
		expect(body.error).toBe("cancelled_by_user");
	});

	test("404 when workspaceId not found", async () => {
		const get = await fetch(
			url(`/workspaces.get?projectId=${PROJECT_ID}&workspaceId=does-not-exist`),
			{ headers: auth() }
		);
		expect(get.status).toBe(404);
	});

	test("unknown workspace returns 404 via typed NotFoundError", async () => {
		const res = await fetch(
			url(`/workspaces.get?projectId=${PROJECT_ID}&workspaceId=does-not-exist`),
			{ headers: auth() }
		);
		expect(res.status).toBe(404);
		const body = (await res.json()) as { error: string };
		expect(body.error).toBe("not_found");
	});
});

describe("control-plane coordination routes", () => {
	test("set_status updates the row", async () => {
		const create = await fetch(url("/workspaces.create"), {
			method: "POST",
			headers: { ...auth(), "Content-Type": "application/json" },
			body: JSON.stringify({ projectId: PROJECT_ID, branch: "feature/cp-s1" }),
		});
		const { workspaceId } = (await create.json()) as { workspaceId: string };

		const res = await fetch(url("/workspaces.set_status"), {
			method: "POST",
			headers: { ...authWs(workspaceId), "Content-Type": "application/json" },
			body: JSON.stringify({
				phase: "blocked",
				statusText: "waiting on review",
				needs: "approval",
			}),
		});
		expect(res.status).toBe(200);

		const get = await fetch(
			url(`/workspaces.get?projectId=${PROJECT_ID}&workspaceId=${workspaceId}`),
			{ headers: auth() }
		);
		const body = (await get.json()) as {
			currentPhase: string;
			statusText: string;
			needs: string;
		};
		expect(body.currentPhase).toBe("blocked");
		expect(body.statusText).toBe("waiting on review");
		expect(body.needs).toBe("approval");
	});

	test("set_status without X-Workspace-Id returns 401", async () => {
		const res = await fetch(url("/workspaces.set_status"), {
			method: "POST",
			headers: { ...auth(), "Content-Type": "application/json" },
			body: JSON.stringify({ phase: "working" }),
		});
		expect(res.status).toBe(401);
	});

	test("send_message + read_messages round-trip", async () => {
		const a = await fetch(url("/workspaces.create"), {
			method: "POST",
			headers: { ...auth(), "Content-Type": "application/json" },
			body: JSON.stringify({ projectId: PROJECT_ID, branch: "feature/cp-m-a" }),
		});
		const wsA = ((await a.json()) as { workspaceId: string }).workspaceId;
		const b = await fetch(url("/workspaces.create"), {
			method: "POST",
			headers: { ...auth(), "Content-Type": "application/json" },
			body: JSON.stringify({ projectId: PROJECT_ID, branch: "feature/cp-m-b" }),
		});
		const wsB = ((await b.json()) as { workspaceId: string }).workspaceId;

		const send = await fetch(url("/workspaces.send_message"), {
			method: "POST",
			headers: { ...authWs(wsA), "Content-Type": "application/json" },
			body: JSON.stringify({
				toWorkspaceId: wsB,
				kind: "note",
				content: "hello from A",
			}),
		});
		expect(send.status).toBe(200);

		const read = await fetch(url(`/workspaces.read_messages?projectId=${PROJECT_ID}`), {
			headers: authWs(wsB),
		});
		const body = (await read.json()) as { messages: Array<{ content: string }> };
		expect(body.messages.map((m) => m.content)).toContain("hello from A");
	});

	test("resume_agent returns 403 for non-orchestrator caller", async () => {
		const a = await fetch(url("/workspaces.create"), {
			method: "POST",
			headers: { ...auth(), "Content-Type": "application/json" },
			body: JSON.stringify({ projectId: PROJECT_ID, branch: "feature/cp-r-403" }),
		});
		const wsA = ((await a.json()) as { workspaceId: string }).workspaceId;
		const b = await fetch(url("/workspaces.create"), {
			method: "POST",
			headers: { ...auth(), "Content-Type": "application/json" },
			body: JSON.stringify({ projectId: PROJECT_ID, branch: "feature/cp-r-403b" }),
		});
		const wsB = ((await b.json()) as { workspaceId: string }).workspaceId;

		const res = await fetch(url("/workspaces.resume_agent"), {
			method: "POST",
			headers: { ...authWs(wsA), "Content-Type": "application/json" },
			body: JSON.stringify({ workspaceId: wsB, message: "go" }),
		});
		expect(res.status).toBe(403);
	});
});

describe("/context.resolve", () => {
	test("returns mode:none when cwd unknown and no token", async () => {
		const res = await fetch(url(`/context.resolve?cwd=${encodeURIComponent("/nowhere")}`), {
			headers: auth(),
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.mode).toBe("none");
	});

	test("returns workspace-agent for registered worktree", async () => {
		const db = getDb();
		const wsId = `ws-${nanoid(6)}`;
		const wtId = `wt-${nanoid(6)}`;
		const now = new Date();
		db.insert(schema.worktrees)
			.values({
				id: wtId,
				projectId: PROJECT_ID,
				path: REPO,
				branch: "feat/x",
				baseBranch: "main",
				createdAt: now,
				updatedAt: now,
			})
			.run();
		db.insert(schema.workspaces)
			.values({
				id: wsId,
				projectId: PROJECT_ID,
				type: "worktree",
				name: "feat/x",
				worktreeId: wtId,
				createdAt: now,
				updatedAt: now,
			})
			.run();
		const res = await fetch(url(`/context.resolve?cwd=${encodeURIComponent(REPO)}`), {
			headers: auth(),
		});
		const body = await res.json();
		expect(body.mode).toBe("workspace-agent");
		expect(body.projectId).toBe(PROJECT_ID);
		expect(body.workspaceId).toBe(wsId);
	});

	test("resolves taskToken to review mode", async () => {
		server.taskRegistry.register("tok-1", {
			mode: "review",
			projectId: PROJECT_ID,
			workspaceId: "ws-r",
			modeContext: { reviewDraftId: "d", dbPath: "/db" },
		});
		const res = await fetch(url(`/context.resolve?cwd=/x&taskToken=tok-1`), { headers: auth() });
		const body = await res.json();
		expect(body.mode).toBe("review");
		expect(body.modeContext.reviewDraftId).toBe("d");
	});

	test("taskToken is single-use", async () => {
		server.taskRegistry.register("tok-2", {
			mode: "solve",
			projectId: PROJECT_ID,
			workspaceId: "ws-s",
			modeContext: {},
		});
		await fetch(url(`/context.resolve?cwd=/x&taskToken=tok-2`), { headers: auth() });
		const res = await fetch(url(`/context.resolve?cwd=/x&taskToken=tok-2`), { headers: auth() });
		const body = await res.json();
		expect(body.mode).toBe("none");
	});

	test("requires auth", async () => {
		const res = await fetch(url("/context.resolve?cwd=/x"));
		expect(res.status).toBe(401);
	});
});
