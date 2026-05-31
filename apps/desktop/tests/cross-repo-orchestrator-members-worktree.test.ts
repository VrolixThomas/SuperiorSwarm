import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "../src/main/db";
import { worktrees, workspaces } from "../src/main/db/schema";
import {
	addProjectToCrossRepoOrchestrator,
	attachToCrossRepoOrchestrator,
	listCrossRepoMembers,
} from "../src/main/services/cross-repo-orchestrator-membership";
import {
	seedCrossRepoOrchestrator,
	seedProject,
	seedWorkspace,
	setupTestDb,
	teardownTestDb,
} from "./helpers/db";

describe("listCrossRepoMembers worktreePath", () => {
	beforeEach(() => setupTestDb());
	afterEach(() => teardownTestDb());

	test("returns the member's worktree path, or null when none", async () => {
		const project = await seedProject();
		const xro = await seedCrossRepoOrchestrator({ projectIds: [project] });

		// Member WITH a worktree
		const withWt = await seedWorkspace(project, { name: "with-wt" });
		const wtId = `wt-${nanoid(6)}`;
		const wtPath = "/tmp/worktrees/with-wt";
		const now = new Date();
		getDb()
			.insert(worktrees)
			.values({
				id: wtId,
				projectId: project,
				path: wtPath,
				branch: "feat/x",
				baseBranch: "main",
				createdAt: now,
				updatedAt: now,
			})
			.run();
		getDb().update(workspaces).set({ worktreeId: wtId }).where(eq(workspaces.id, withWt)).run();

		// Member WITHOUT a worktree
		const noWt = await seedWorkspace(project, { name: "no-wt" });

		await addProjectToCrossRepoOrchestrator({ orchestratorId: xro, projectId: project });
		await attachToCrossRepoOrchestrator({ orchestratorId: xro, workspaceId: withWt });
		await attachToCrossRepoOrchestrator({ orchestratorId: xro, workspaceId: noWt });

		const members = await listCrossRepoMembers({ orchestratorId: xro });
		const byId = new Map(members.map((m) => [m.workspaceId, m]));
		expect(byId.get(withWt)?.worktreePath).toBe(wtPath);
		expect(byId.get(noWt)?.worktreePath).toBeNull();
	});
});
