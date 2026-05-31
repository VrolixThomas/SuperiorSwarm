import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nanoid } from "nanoid";
import simpleGit from "simple-git";
import { getDb } from "../src/main/db";
import { projects } from "../src/main/db/schema";
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
import { seedCrossRepoOrchestrator, setupTestDb, teardownTestDb } from "./helpers/db";

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

		const res = await dispatchAcrossRepos({
			orchestratorId,
			task: "Add idempotency keys",
			targets: [{ projectId: PROJECT_ID, branch: "feat/idempotency" }],
		});

		expect(res.created).toHaveLength(1);
		const workspaceId = res.created[0]!.workspaceId;

		const members = await listCrossRepoMembers({ orchestratorId });
		expect(members.map((m) => m.workspaceId)).toContain(workspaceId);
	});
});
