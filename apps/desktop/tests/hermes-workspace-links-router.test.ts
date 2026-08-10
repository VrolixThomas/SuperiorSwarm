import "./preload-electron-mock";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { _setDbForTesting, schema } from "../src/main/db";
import { t } from "../src/main/trpc";
import { hermesRouter } from "../src/main/trpc/routers/hermes";
import { hermesSessionIdentityKey } from "../src/shared/hermes";
import { makeTestDb } from "./test-db";

describe("Hermes workspace link router", () => {
	let db: ReturnType<typeof makeTestDb>;

	beforeEach(() => {
		db = makeTestDb();
		_setDbForTesting(db);
		const now = new Date();
		db.insert(schema.hermesConnections)
			.values({
				id: "connection-1",
				label: "Cross-profile Hermes",
				baseUrl: "http://localhost:8080",
				profileId: "work",
				createdAt: now,
				updatedAt: now,
			})
			.run();
		for (const profileId of ["work", "personal"] as const) {
			db.insert(schema.projects)
				.values({
					id: `project-${profileId}`,
					name: `${profileId} project`,
					repoPath: `/repos/${profileId}`,
					defaultBranch: "main",
					createdAt: now,
					updatedAt: now,
				})
				.run();
			db.insert(schema.worktrees)
				.values({
					id: `worktree-${profileId}`,
					projectId: `project-${profileId}`,
					path: `/repos/${profileId}-worktrees/task`,
					branch: `feat/${profileId}`,
					baseBranch: "main",
					createdAt: now,
					updatedAt: now,
				})
				.run();
			db.insert(schema.workspaces)
				.values({
					id: `workspace-${profileId}`,
					projectId: `project-${profileId}`,
					type: "worktree",
					name: `${profileId} workspace`,
					worktreeId: `worktree-${profileId}`,
					createdAt: now,
					updatedAt: now,
				})
				.run();
		}
	});

	afterEach(() => {
		_setDbForTesting(null);
	});

	test("requires profile identity for DTOs and indexes colliding sessions separately", async () => {
		const caller = t.createCallerFactory(hermesRouter)({});
		for (const profileId of ["work", "personal"] as const) {
			await caller.linkWorkspace({
				connectionId: "connection-1",
				profileId,
				hermesSessionId: "shared-session",
				workspaceId: `workspace-${profileId}`,
			});
		}

		const index = await caller.workspaceLinkIndex({ connectionId: "connection-1" });
		expect(index).toEqual({
			[hermesSessionIdentityKey("work", "shared-session")]: {
				count: 1,
				branches: ["feat/work"],
				projectNames: ["work project"],
			},
			[hermesSessionIdentityKey("personal", "shared-session")]: {
				count: 1,
				branches: ["feat/personal"],
				projectNames: ["personal project"],
			},
		});
		const workLinks = await caller.workspaceLinks({
			connectionId: "connection-1",
			profileId: "work",
			hermesSessionId: "shared-session",
		});
		expect(workLinks).toEqual([
			expect.objectContaining({
				profileId: "work",
				workspaceId: "workspace-work",
				branch: "feat/work",
			}),
		]);
		expect(JSON.stringify(workLinks)).not.toContain("workspace-personal");

		await caller.unlinkWorkspace({
			connectionId: "connection-1",
			profileId: "work",
			hermesSessionId: "shared-session",
			workspaceId: "workspace-work",
		});
		expect(
			await caller.workspaceLinks({
				connectionId: "connection-1",
				profileId: "personal",
				hermesSessionId: "shared-session",
			})
		).toHaveLength(1);
	});
});
