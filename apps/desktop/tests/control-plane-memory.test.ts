import "./preload-electron-mock";
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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
let USER_DATA: string;
let REPO: string;
let PROJECT_ID: string;
let WORKTREE_ID: string;
let WORKSPACE_ID: string;
let server: Awaited<ReturnType<typeof startControlPlane>>;

beforeAll(() => {
	const db = getDb();
	migrate(db, { migrationsFolder: join(import.meta.dir, "../src/main/db/migrations") });
});

beforeEach(async () => {
	TMP = mkdtempSync(join(tmpdir(), "cp-mem-"));
	USER_DATA = join(TMP, "userData");
	mkdirSync(USER_DATA, { recursive: true });
	REPO = join(TMP, "repo");
	mkdirSync(REPO, { recursive: true });
	await initRepo(REPO, "main");
	await simpleGit(REPO).raw(["commit", "--allow-empty", "-m", "init"]);

	PROJECT_ID = `proj-${nanoid(8)}`;
	WORKTREE_ID = `wt-${nanoid(8)}`;
	WORKSPACE_ID = `ws-${nanoid(8)}`;
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
	db.insert(schema.worktrees)
		.values({
			id: WORKTREE_ID,
			projectId: PROJECT_ID,
			path: REPO,
			branch: "main",
			baseBranch: "main",
			createdAt: now,
			updatedAt: now,
		})
		.run();
	db.insert(schema.workspaces)
		.values({
			id: WORKSPACE_ID,
			projectId: PROJECT_ID,
			type: "branch",
			name: "main",
			worktreeId: WORKTREE_ID,
			createdAt: now,
			updatedAt: now,
		})
		.run();

	server = await startControlPlane({
		confirm: async () => true,
		spawnFn: async () => ({ sessionId: "s", terminalId: "t" }),
		userDataPath: USER_DATA,
	});
});

afterEach(async () => {
	await server.stop();
	const db = getDb();
	db.delete(schema.projects).where(eq(schema.projects.id, PROJECT_ID)).run();
	rmSync(TMP, { recursive: true, force: true });
});

const url = (p: string) => `http://127.0.0.1:${server.port}${p}`;
const headers = () => ({
	Authorization: `Bearer ${server.token}`,
	"X-Workspace-Id": WORKSPACE_ID,
	"Content-Type": "application/json",
});
const noWs = () => ({
	Authorization: `Bearer ${server.token}`,
	"Content-Type": "application/json",
});

describe("control-plane memory routes", () => {
	test("rejects POST /memory.add_goal with missing X-Workspace-Id (401)", async () => {
		const res = await fetch(url("/memory.add_goal"), {
			method: "POST",
			headers: noWs(),
			body: JSON.stringify({ title: "x" }),
		});
		expect(res.status).toBe(401);
	});

	test("rejects POST /memory.add_goal with invalid body (400)", async () => {
		const res = await fetch(url("/memory.add_goal"), {
			method: "POST",
			headers: headers(),
			body: JSON.stringify({}),
		});
		expect(res.status).toBe(400);
	});

	test("POST + GET goals round-trips and scopes to caller's project", async () => {
		const add = await fetch(url("/memory.add_goal"), {
			method: "POST",
			headers: headers(),
			body: JSON.stringify({ title: "Ship MVP", body: "by Friday" }),
		});
		expect(add.status).toBe(200);
		const { id } = (await add.json()) as { id: string };
		expect(id).toMatch(/^goal_/);

		const list = await fetch(url("/memory.list_goals"), { headers: headers() });
		expect(list.status).toBe(200);
		const { goals } = (await list.json()) as { goals: Array<{ id: string; title: string }> };
		expect(goals.map((g) => g.title)).toContain("Ship MVP");
	});

	test("POST /memory.log_decision then GET /memory.list_decisions", async () => {
		const add = await fetch(url("/memory.log_decision"), {
			method: "POST",
			headers: headers(),
			body: JSON.stringify({ title: "Use SQLite", rationale: "Embedded, zero ops." }),
		});
		expect(add.status).toBe(200);

		const list = await fetch(url("/memory.list_decisions"), { headers: headers() });
		const { decisions } = (await list.json()) as { decisions: Array<{ title: string }> };
		expect(decisions.map((d) => d.title)).toContain("Use SQLite");
	});

	test("question add → answer → list filters", async () => {
		const add = await fetch(url("/memory.add_question"), {
			method: "POST",
			headers: headers(),
			body: JSON.stringify({ question: "Which auth provider?" }),
		});
		const { id } = (await add.json()) as { id: string };

		const answer = await fetch(url("/memory.answer_question"), {
			method: "POST",
			headers: headers(),
			body: JSON.stringify({ id, answer: "Clerk" }),
		});
		expect(answer.status).toBe(200);

		const openList = await fetch(url("/memory.list_questions?status=open"), { headers: headers() });
		const openRes = (await openList.json()) as { questions: Array<{ id: string }> };
		expect(openRes.questions.find((q) => q.id === id)).toBeUndefined();

		const answeredList = await fetch(url("/memory.list_questions?status=answered"), {
			headers: headers(),
		});
		const answeredRes = (await answeredList.json()) as { questions: Array<{ id: string }> };
		expect(answeredRes.questions.find((q) => q.id === id)).toBeDefined();
	});

	test("journal_start writes Markdown file under userDataPath/memory/<projectId>/journal/", async () => {
		const start = await fetch(url("/memory.journal_start"), {
			method: "POST",
			headers: headers(),
			body: JSON.stringify({}),
		});
		expect(start.status).toBe(200);
		const { sessionId, filePath } = (await start.json()) as {
			sessionId: string;
			filePath: string;
		};
		expect(sessionId).toMatch(/^sess_/);
		expect(filePath).toContain(join(USER_DATA, "memory", PROJECT_ID, "journal"));
		expect(readFileSync(filePath, "utf-8")).toContain("Session");

		const append = await fetch(url("/memory.journal_append"), {
			method: "POST",
			headers: headers(),
			body: JSON.stringify({ sessionId, text: "Implemented routes." }),
		});
		expect(append.status).toBe(200);

		const read = await fetch(
			url(`/memory.read_journal?sessionId=${encodeURIComponent(sessionId)}`),
			{ headers: headers() }
		);
		const { content } = (await read.json()) as { content: string };
		expect(content).toContain("Implemented routes.");
	});

	test("search returns hits across kinds for the caller's project", async () => {
		await fetch(url("/memory.add_goal"), {
			method: "POST",
			headers: headers(),
			body: JSON.stringify({ title: "Caboodle integration" }),
		});
		await fetch(url("/memory.log_decision"), {
			method: "POST",
			headers: headers(),
			body: JSON.stringify({
				title: "Defer caboodle redesign",
				rationale: "Out of scope this quarter.",
			}),
		});

		const search = await fetch(url(`/memory.search?query=${encodeURIComponent("caboodle")}`), {
			headers: headers(),
		});
		expect(search.status).toBe(200);
		const { hits } = (await search.json()) as {
			hits: Array<{ kind: string; refId: string }>;
		};
		const kinds = hits.map((h) => h.kind);
		expect(kinds).toContain("goal");
		expect(kinds).toContain("decision");
	});
});
