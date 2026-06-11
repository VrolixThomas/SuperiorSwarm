import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import simpleGit from "simple-git";
import { getDb } from "../src/main/db";
import { projects, terminalSessions } from "../src/main/db/schema";
import { initRepo } from "../src/main/git/operations";
import { listCrossRepoMembers } from "../src/main/services/cross-repo-orchestrator-membership";
import {
	createCrossRepoOrchestrator,
	deleteCrossRepoOrchestrator,
	dispatchAcrossRepos,
	getCrossRepoOrchestrator,
	listCrossRepoOrchestrators,
	renameCrossRepoOrchestrator,
} from "../src/main/services/cross-repo-orchestrators";
import { seedCrossRepoOrchestrator, seedProject, setupTestDb, teardownTestDb } from "./helpers/db";

describe("cross-repo-orchestrators CRUD", () => {
	beforeEach(() => setupTestDb());
	afterEach(() => teardownTestDb());

	test("create returns id with xro- prefix and persists row", async () => {
		const id = await createCrossRepoOrchestrator({
			name: "Auth migration",
			agentKind: "claude",
		});
		expect(id).toMatch(/^xro-/);
		const row = await getCrossRepoOrchestrator({ id });
		expect(row?.name).toBe("Auth migration");
		expect(row?.agentKind).toBe("claude");
		expect(row?.status).toBe("idle");
		expect(row?.workDir).toContain(id);
	});

	test("list returns rows ordered by sortOrder asc", async () => {
		const a = await createCrossRepoOrchestrator({ name: "a", agentKind: "claude" });
		const b = await createCrossRepoOrchestrator({ name: "b", agentKind: "claude" });
		const all = await listCrossRepoOrchestrators();
		expect(all.map((r) => r.id)).toEqual([a, b]);
	});

	test("rename updates name and updatedAt", async () => {
		const id = await createCrossRepoOrchestrator({ name: "old", agentKind: "claude" });
		const before = (await getCrossRepoOrchestrator({ id }))!;
		await new Promise((r) => setTimeout(r, 1100));
		await renameCrossRepoOrchestrator({ id, name: "new" });
		const after = (await getCrossRepoOrchestrator({ id }))!;
		expect(after.name).toBe("new");
		expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
	});

	test("delete removes the row", async () => {
		const id = await createCrossRepoOrchestrator({ name: "doomed", agentKind: "claude" });
		await deleteCrossRepoOrchestrator({ id });
		expect(await getCrossRepoOrchestrator({ id })).toBeUndefined();
	});

	test("delete disposes coordinator terminal sessions", async () => {
		const xro = await seedCrossRepoOrchestrator({});
		const now = new Date();
		getDb()
			.insert(terminalSessions)
			.values({
				id: `term-${nanoid(6)}`,
				workspaceId: xro,
				title: "Coordinator",
				cwd: `/tmp/xro-${xro}`,
				sortOrder: 0,
				updatedAt: now,
			})
			.run();

		await deleteCrossRepoOrchestrator({ id: xro });

		const left = getDb()
			.select()
			.from(terminalSessions)
			.where(eq(terminalSessions.workspaceId, xro))
			.all();
		expect(left).toHaveLength(0);
	});

	test("create assigns the first free colorIndex; list backfills nulls", async () => {
		const a = await createCrossRepoOrchestrator({ name: "a", agentKind: "claude" });
		const b = await createCrossRepoOrchestrator({ name: "b", agentKind: "claude" });
		const rows = await listCrossRepoOrchestrators();
		const ca = rows.find((r) => r.id === a)?.colorIndex;
		const cb = rows.find((r) => r.id === b)?.colorIndex;
		expect(ca).not.toBeNull();
		expect(cb).not.toBeNull();
		expect(ca).not.toBe(cb);

		const legacy = await seedCrossRepoOrchestrator({}); // seeds with NULL colorIndex
		const rows2 = await listCrossRepoOrchestrators();
		expect(rows2.find((r) => r.id === legacy)?.colorIndex).not.toBeNull();
	});

	test("list returns linkedProjectIds per orchestrator", async () => {
		const p1 = await seedProject();
		const p2 = await seedProject();
		const xro = await seedCrossRepoOrchestrator({ projectIds: [p1, p2] });

		const rows = await listCrossRepoOrchestrators();
		const row = rows.find((r) => r.id === xro);
		expect(row?.linkedProjectIds?.sort()).toEqual([p1, p2].sort());
	});
});

describe("dispatchAcrossRepos", () => {
	let TMP: string;
	let PROJECT_ID: string;

	beforeEach(async () => {
		setupTestDb();
		TMP = mkdtempSync(join(tmpdir(), "xro-dispatch-"));
		const repo = join(TMP, "repo");
		mkdirSync(repo, { recursive: true });
		await initRepo(repo, "main");
		await simpleGit(repo).raw(["commit", "--allow-empty", "-m", "init"]);

		PROJECT_ID = `proj-${nanoid(8)}`;
		const now = new Date();
		getDb()
			.insert(projects)
			.values({
				id: PROJECT_ID,
				repoPath: repo,
				name: "repo",
				defaultBranch: "main",
				createdAt: now,
				updatedAt: now,
			})
			.run();
	});

	afterEach(() => {
		teardownTestDb();
		getDb().run("DELETE FROM projects");
		rmSync(TMP, { recursive: true, force: true });
	});

	test("creates a worktree workspace per target and attaches it as a member", async () => {
		const orchestratorId = await seedCrossRepoOrchestrator({ projectIds: [PROJECT_ID] });

		const res = await dispatchAcrossRepos(
			{
				orchestratorId,
				task: "Add idempotency keys",
				targets: [{ projectId: PROJECT_ID, branch: "feat/idempotency" }],
			},
			{
				dispatchAgentFn: async () => ({
					sessionId: "s",
					terminalId: "t",
					status: "started" as const,
				}),
			}
		);

		expect(res.failed).toHaveLength(0);
		expect(res.created).toHaveLength(1);
		const workspaceId = res.created[0]!.workspaceId;

		const members = await listCrossRepoMembers({ orchestratorId });
		expect(members.map((m) => m.workspaceId)).toContain(workspaceId);
	});
});
