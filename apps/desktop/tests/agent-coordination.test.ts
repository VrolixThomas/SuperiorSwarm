import "./preload-electron-mock";
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { nanoid } from "nanoid";
import simpleGit from "simple-git";
import { getDb, schema } from "../src/main/db";
import { initRepo } from "../src/main/git/operations";
import {
	createWorkspace,
	readMessages,
	sendMessage,
	setOrchestrator,
	setStatus,
} from "../src/main/services/workspace-service";

let TMP: string;
let REPO: string;
let PROJECT_ID: string;

beforeAll(() => {
	const db = getDb();
	migrate(db, { migrationsFolder: join(import.meta.dir, "../src/main/db/migrations") });
});

beforeEach(async () => {
	TMP = mkdtempSync(join(tmpdir(), "coord-"));
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
});

afterEach(() => {
	const db = getDb();
	db.delete(schema.projects).where(eq(schema.projects.id, PROJECT_ID)).run();
	rmSync(TMP, { recursive: true, force: true });
});

describe("setStatus", () => {
	test("updates phase + status_text + needs", async () => {
		const ws = await createWorkspace({ projectId: PROJECT_ID, branch: "feature/a" });
		await setStatus(
			{ workspaceId: ws.workspaceId, projectId: PROJECT_ID },
			{ phase: "blocked", statusText: "waiting", needs: "decision X" }
		);
		const db = getDb();
		const row = db
			.select()
			.from(schema.workspaces)
			.where(eq(schema.workspaces.id, ws.workspaceId))
			.get();
		expect(row?.currentPhase).toBe("blocked");
		expect(row?.statusText).toBe("waiting");
		expect(row?.needs).toBe("decision X");
		expect(row?.statusUpdatedAt).toBeTruthy();
	});
});

describe("setOrchestrator", () => {
	test("flips the bit on chosen workspace, clears others in same project", async () => {
		const a = await createWorkspace({ projectId: PROJECT_ID, branch: "feature/orch-a" });
		const b = await createWorkspace({ projectId: PROJECT_ID, branch: "feature/orch-b" });
		await setOrchestrator({ workspaceId: a.workspaceId });
		await setOrchestrator({ workspaceId: b.workspaceId });

		const db = getDb();
		const rowA = db
			.select()
			.from(schema.workspaces)
			.where(eq(schema.workspaces.id, a.workspaceId))
			.get();
		const rowB = db
			.select()
			.from(schema.workspaces)
			.where(eq(schema.workspaces.id, b.workspaceId))
			.get();
		expect(rowA?.isOrchestrator).toBe(false);
		expect(rowB?.isOrchestrator).toBe(true);
	});
});

describe("sendMessage / readMessages", () => {
	test("DM lands in target's inbox", async () => {
		const a = await createWorkspace({ projectId: PROJECT_ID, branch: "feature/msg-a" });
		const b = await createWorkspace({ projectId: PROJECT_ID, branch: "feature/msg-b" });

		const sent = await sendMessage(
			{ workspaceId: a.workspaceId, projectId: PROJECT_ID },
			{ toWorkspaceId: b.workspaceId, kind: "note", content: "hello B" }
		);
		expect(sent.messageId).toBeTruthy();

		const inbox = await readMessages(
			{ workspaceId: b.workspaceId, projectId: PROJECT_ID },
			{}
		);
		expect(inbox.messages.map((m) => m.content)).toContain("hello B");
		expect(inbox.messages[0]?.kind).toBe("note");
		expect(inbox.messages[0]?.fromWorkspaceId).toBe(a.workspaceId);
	});

	test("broadcast lands in everyone's inbox", async () => {
		const a = await createWorkspace({ projectId: PROJECT_ID, branch: "feature/bcast-a" });
		const b = await createWorkspace({ projectId: PROJECT_ID, branch: "feature/bcast-b" });

		await sendMessage(
			{ workspaceId: a.workspaceId, projectId: PROJECT_ID },
			{ kind: "note", content: "everyone heads up" }
		);

		const inboxB = await readMessages(
			{ workspaceId: b.workspaceId, projectId: PROJECT_ID },
			{ includeBroadcasts: true }
		);
		expect(inboxB.messages.map((m) => m.content)).toContain("everyone heads up");
		expect(inboxB.messages[0]?.toWorkspaceId).toBeNull();
	});

	test("readMessages filters by since", async () => {
		const a = await createWorkspace({ projectId: PROJECT_ID, branch: "feature/since-a" });
		const b = await createWorkspace({ projectId: PROJECT_ID, branch: "feature/since-b" });

		await sendMessage(
			{ workspaceId: a.workspaceId, projectId: PROJECT_ID },
			{ toWorkspaceId: b.workspaceId, kind: "note", content: "old" }
		);
		const cutoff = new Date().toISOString();
		await new Promise((r) => setTimeout(r, 10));
		await sendMessage(
			{ workspaceId: a.workspaceId, projectId: PROJECT_ID },
			{ toWorkspaceId: b.workspaceId, kind: "note", content: "new" }
		);

		const inbox = await readMessages(
			{ workspaceId: b.workspaceId, projectId: PROJECT_ID },
			{ since: cutoff }
		);
		const contents = inbox.messages.map((m) => m.content);
		expect(contents).toContain("new");
		expect(contents).not.toContain("old");
	});

	test("sendMessage rejects cross-project target", async () => {
		const a = await createWorkspace({ projectId: PROJECT_ID, branch: "feature/cross-a" });
		await expect(
			sendMessage(
				{ workspaceId: a.workspaceId, projectId: PROJECT_ID },
				{ toWorkspaceId: "ws-in-other-project", kind: "note", content: "x" }
			)
		).rejects.toThrow(/forbidden|not_found/i);
	});
});
