import "./preload-electron-mock";
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { nanoid } from "nanoid";
import simpleGit from "simple-git";
import { EventBus } from "../src/main/control-plane/event-bus";
import {
	attachOrchestratorEventSink,
	eventsFilePathForProject,
	setEventsDir,
} from "../src/main/control-plane/orchestrator-event-sink";
import { getDb, schema } from "../src/main/db";
import { initRepo } from "../src/main/git/operations";
import {
	type CallerContext,
	createWorkspace,
	readMessages,
	removeWorkspace,
	resumeAgent,
	sendMessage,
	setEventBus,
	setOrchestrator,
	setStatus,
	unsetOrchestrator,
} from "../src/main/services/workspace-service";

function wsCtx(workspaceId: string, projectId: string): CallerContext {
	return { kind: "workspace", workspaceId, projectId };
}

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

	// Sink writes events to setEventsDir(); point it inside TMP so tests don't
	// touch the real userData dir.
	setEventsDir(join(TMP, "events"));

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
			wsCtx(ws.workspaceId, PROJECT_ID),
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
	test("setOrchestrator can promote multiple workspaces independently", async () => {
		const a = await createWorkspace({ projectId: PROJECT_ID, branch: "feature/orch-a" });
		const b = await createWorkspace({ projectId: PROJECT_ID, branch: "feature/orch-b" });
		await setOrchestrator(wsCtx(a.workspaceId, PROJECT_ID), { workspaceId: a.workspaceId });
		await setOrchestrator(wsCtx(b.workspaceId, PROJECT_ID), { workspaceId: b.workspaceId });

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
		expect(rowA?.isOrchestrator).toBe(true);
		expect(rowB?.isOrchestrator).toBe(true);
	});

	test("unsetOrchestrator clears flag and detaches members", async () => {
		const { attachToOrchestrator, listMembership } = await import(
			"../src/main/services/orchestrator-membership"
		);

		const orch = await createWorkspace({ projectId: PROJECT_ID, branch: "feature/unset-orch" });
		const child = await createWorkspace({ projectId: PROJECT_ID, branch: "feature/unset-child" });
		await setOrchestrator(wsCtx(orch.workspaceId, PROJECT_ID), { workspaceId: orch.workspaceId });
		await attachToOrchestrator({
			orchestratorId: orch.workspaceId,
			workspaceId: child.workspaceId,
		});

		await unsetOrchestrator(wsCtx(orch.workspaceId, PROJECT_ID), { workspaceId: orch.workspaceId });

		const db = getDb();
		const row = db
			.select()
			.from(schema.workspaces)
			.where(eq(schema.workspaces.id, orch.workspaceId))
			.get();
		expect(row?.isOrchestrator).toBe(false);
		const members = await listMembership({ orchestratorId: orch.workspaceId });
		expect(members.length).toBe(0);
	});

	test("setOrchestrator rejects cross-project caller", async () => {
		const wsA = await createWorkspace({ projectId: PROJECT_ID, branch: "feature/orch-cross-a" });

		const OTHER_PROJECT = `proj-${nanoid(8)}`;
		const OTHER_REPO = join(TMP, "other-repo-orch");
		mkdirSync(OTHER_REPO, { recursive: true });
		await initRepo(OTHER_REPO, "main");
		await simpleGit(OTHER_REPO).raw(["commit", "--allow-empty", "-m", "init"]);
		const db = getDb();
		const now = new Date();
		db.insert(schema.projects)
			.values({
				id: OTHER_PROJECT,
				repoPath: OTHER_REPO,
				name: "other-orch",
				defaultBranch: "main",
				createdAt: now,
				updatedAt: now,
			})
			.run();
		const wsB = await createWorkspace({
			projectId: OTHER_PROJECT,
			branch: "feature/orch-cross-b",
		});

		await expect(
			setOrchestrator(wsCtx(wsA.workspaceId, PROJECT_ID), { workspaceId: wsB.workspaceId })
		).rejects.toThrow(/forbidden: cross-project/);

		db.delete(schema.projects).where(eq(schema.projects.id, OTHER_PROJECT)).run();
	});
});

describe("sendMessage / readMessages", () => {
	test("DM lands in target's inbox", async () => {
		const a = await createWorkspace({ projectId: PROJECT_ID, branch: "feature/msg-a" });
		const b = await createWorkspace({ projectId: PROJECT_ID, branch: "feature/msg-b" });

		const sent = await sendMessage(
			wsCtx(a.workspaceId, PROJECT_ID),
			{ toWorkspaceId: b.workspaceId, kind: "note", content: "hello B" }
		);
		expect(sent.messageId).toBeTruthy();

		const inbox = await readMessages(wsCtx(b.workspaceId, PROJECT_ID), {});
		expect(inbox.messages.map((m) => m.content)).toContain("hello B");
		expect(inbox.messages[0]?.kind).toBe("note");
		expect(inbox.messages[0]?.fromWorkspaceId).toBe(a.workspaceId);
	});

	test("broadcast lands in everyone's inbox", async () => {
		const a = await createWorkspace({ projectId: PROJECT_ID, branch: "feature/bcast-a" });
		const b = await createWorkspace({ projectId: PROJECT_ID, branch: "feature/bcast-b" });

		await sendMessage(wsCtx(a.workspaceId, PROJECT_ID), { kind: "note", content: "everyone heads up" });

		const inboxB = await readMessages(wsCtx(b.workspaceId, PROJECT_ID), {
			includeBroadcasts: true,
		});
		expect(inboxB.messages.map((m) => m.content)).toContain("everyone heads up");
		expect(inboxB.messages[0]?.toWorkspaceId).toBeNull();
	});

	test("readMessages filters by since", async () => {
		const a = await createWorkspace({ projectId: PROJECT_ID, branch: "feature/since-a" });
		const b = await createWorkspace({ projectId: PROJECT_ID, branch: "feature/since-b" });

		await sendMessage(wsCtx(a.workspaceId, PROJECT_ID), {
			toWorkspaceId: b.workspaceId,
			kind: "note",
			content: "old",
		});
		const cutoff = new Date().toISOString();
		await new Promise((r) => setTimeout(r, 10));
		await sendMessage(wsCtx(a.workspaceId, PROJECT_ID), {
			toWorkspaceId: b.workspaceId,
			kind: "note",
			content: "new",
		});

		const inbox = await readMessages(wsCtx(b.workspaceId, PROJECT_ID), { since: cutoff });
		const contents = inbox.messages.map((m) => m.content);
		expect(contents).toContain("new");
		expect(contents).not.toContain("old");
	});

	test("sendMessage rejects cross-project target", async () => {
		const a = await createWorkspace({ projectId: PROJECT_ID, branch: "feature/cross-a" });

		// Create a second project + workspace so we exercise the forbidden branch
		// (cross-project DM), not just not_found
		const OTHER_PROJECT = `proj-${nanoid(8)}`;
		const OTHER_REPO = join(TMP, "other-repo");
		mkdirSync(OTHER_REPO, { recursive: true });
		await initRepo(OTHER_REPO, "main");
		await simpleGit(OTHER_REPO).raw(["commit", "--allow-empty", "-m", "init"]);
		const db = getDb();
		const now = new Date();
		db.insert(schema.projects)
			.values({
				id: OTHER_PROJECT,
				repoPath: OTHER_REPO,
				name: "other",
				defaultBranch: "main",
				createdAt: now,
				updatedAt: now,
			})
			.run();
		const otherWs = await createWorkspace({
			projectId: OTHER_PROJECT,
			branch: "feature/cross-other",
		});

		await expect(
			sendMessage(wsCtx(a.workspaceId, PROJECT_ID), {
				toWorkspaceId: otherWs.workspaceId,
				kind: "note",
				content: "x",
			})
		).rejects.toThrow(/forbidden/i);

		db.delete(schema.projects).where(eq(schema.projects.id, OTHER_PROJECT)).run();
	});
});

describe("agent_messages audit retention", () => {
	test("audit retention: deleting sender preserves message with fromWorkspaceId=null", async () => {
		const sender = await createWorkspace({
			projectId: PROJECT_ID,
			branch: "feature/audit-sender2",
		});
		const recipient = await createWorkspace({
			projectId: PROJECT_ID,
			branch: "feature/audit-recipient2",
		});
		await sendMessage(wsCtx(sender.workspaceId, PROJECT_ID), {
			toWorkspaceId: recipient.workspaceId,
			kind: "note",
			content: "audit me",
		});

		await removeWorkspace({ workspaceId: sender.workspaceId, projectId: PROJECT_ID, force: true });

		const db = getDb();
		const rows = db
			.select()
			.from(schema.agentMessages)
			.where(eq(schema.agentMessages.toWorkspaceId, recipient.workspaceId))
			.all();
		expect(rows.length).toBe(1);
		expect(rows[0]?.fromWorkspaceId).toBeNull();
		expect(rows[0]?.content).toBe("audit me");
	});

	test("messages persist after recipient workspace is removed (toWorkspaceId SET NULL)", async () => {
		const sender = await createWorkspace({
			projectId: PROJECT_ID,
			branch: "feature/audit-sender",
		});
		const recipient = await createWorkspace({
			projectId: PROJECT_ID,
			branch: "feature/audit-recipient",
		});
		await sendMessage(wsCtx(sender.workspaceId, PROJECT_ID), {
			toWorkspaceId: recipient.workspaceId,
			kind: "note",
			content: "for the record",
		});

		const db = getDb();
		// Delete the recipient workspace + its worktree row to trigger the FK SET NULL
		db.delete(schema.workspaces).where(eq(schema.workspaces.id, recipient.workspaceId)).run();

		const surviving = db
			.select()
			.from(schema.agentMessages)
			.where(eq(schema.agentMessages.fromWorkspaceId, sender.workspaceId))
			.all();
		expect(surviving).toHaveLength(1);
		expect(surviving[0]?.toWorkspaceId).toBeNull();
		expect(surviving[0]?.content).toBe("for the record");
	});
});

describe("orchestrator event sink", () => {
	test("appends a JSON line to <eventsDir>/<projectId>.jsonl when project has an orchestrator", async () => {
		const orch = await createWorkspace({ projectId: PROJECT_ID, branch: "feature/sink-orch" });
		const other = await createWorkspace({ projectId: PROJECT_ID, branch: "feature/sink-other" });
		await setOrchestrator(wsCtx(orch.workspaceId, PROJECT_ID), { workspaceId: orch.workspaceId });

		const bus = new EventBus();
		setEventBus(bus);
		const detach = attachOrchestratorEventSink(bus);
		try {
			await setStatus(wsCtx(other.workspaceId, PROJECT_ID), { phase: "blocked", needs: "ack" });
			await sendMessage(wsCtx(other.workspaceId, PROJECT_ID), {
				toWorkspaceId: orch.workspaceId,
				kind: "note",
				content: "ping",
			});

			const file = eventsFilePathForProject(PROJECT_ID);
			const lines = readFileSync(file, "utf-8")
				.trim()
				.split("\n")
				.map((l) => JSON.parse(l));
			expect(lines).toHaveLength(2);
			expect(lines[0]?.event).toBe("status");
			expect(lines[0]?.phase).toBe("blocked");
			expect(lines[1]?.event).toBe("message");
			expect(lines[1]?.content).toBe("ping");
			// File must live outside the worktree so it can never leak into git.
			expect(file).not.toContain(orch.path);
		} finally {
			detach();
			setEventBus(null);
		}
	});

	test("no orchestrator → no file written", async () => {
		const a = await createWorkspace({ projectId: PROJECT_ID, branch: "feature/sink-noop-a" });

		const bus = new EventBus();
		setEventBus(bus);
		const detach = attachOrchestratorEventSink(bus);
		try {
			await setStatus(wsCtx(a.workspaceId, PROJECT_ID), { phase: "working" });
			const file = eventsFilePathForProject(PROJECT_ID);
			const { existsSync } = await import("node:fs");
			expect(existsSync(file)).toBe(false);
		} finally {
			detach();
			setEventBus(null);
		}
	});
});

describe("resumeAgent", () => {
	test("rejects non-orchestrator caller with forbidden", async () => {
		const a = await createWorkspace({ projectId: PROJECT_ID, branch: "feature/r-a" });
		const b = await createWorkspace({ projectId: PROJECT_ID, branch: "feature/r-b" });
		// Neither is orchestrator
		await expect(
			resumeAgent(
				wsCtx(a.workspaceId, PROJECT_ID),
				{ workspaceId: b.workspaceId, message: "hi" },
				{ respawnAgent: async () => undefined }
			)
		).rejects.toThrow(/forbidden/i);
	});

	test("orchestrator can resume — writes message row + calls respawnAgent", async () => {
		const orch = await createWorkspace({
			projectId: PROJECT_ID,
			branch: "feature/orch-main",
		});
		const target = await createWorkspace({
			projectId: PROJECT_ID,
			branch: "feature/orch-tgt",
		});
		await setOrchestrator(wsCtx(orch.workspaceId, PROJECT_ID), { workspaceId: orch.workspaceId });
		const db = getDb();
		db.update(schema.workspaces)
			.set({ cliSessionId: "uuid-target", cliPreset: "claude" })
			.where(eq(schema.workspaces.id, target.workspaceId))
			.run();

		const calls: Array<{ command: string; cwd: string; workspaceId: string }> = [];
		const result = await resumeAgent(
			wsCtx(orch.workspaceId, PROJECT_ID),
			{ workspaceId: target.workspaceId, message: "next task" },
			{
				respawnAgent: async (args) => {
					calls.push(args);
				},
			}
		);
		expect(result.ok).toBe(true);
		expect(result.messageId).toBeTruthy();
		expect(calls).toHaveLength(1);
		expect(calls[0]?.command).toContain("claude --resume 'uuid-target'");
		expect(calls[0]?.command).toContain("--dangerously-skip-permissions");
		expect(calls[0]?.command).toContain("'next task'");

		const messageRows = db
			.select()
			.from(schema.agentMessages)
			.where(eq(schema.agentMessages.toWorkspaceId, target.workspaceId))
			.all();
		expect(messageRows).toHaveLength(1);
		expect(messageRows[0]?.kind).toBe("resume");
		expect(messageRows[0]?.content).toBe("next task");
	});

	test("orchestrator resuming non-claude target returns resume_not_supported", async () => {
		const orch = await createWorkspace({
			projectId: PROJECT_ID,
			branch: "feature/r-no-claude-o",
		});
		const target = await createWorkspace({
			projectId: PROJECT_ID,
			branch: "feature/r-no-claude-t",
		});
		await setOrchestrator(wsCtx(orch.workspaceId, PROJECT_ID), { workspaceId: orch.workspaceId });

		await expect(
			resumeAgent(
				wsCtx(orch.workspaceId, PROJECT_ID),
				{ workspaceId: target.workspaceId, message: "x" },
				{ respawnAgent: async () => undefined }
			)
		).rejects.toThrow(/resume_not_supported/);
	});
});
