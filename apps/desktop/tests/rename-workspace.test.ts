import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { getDb } from "../src/main/db";
import { workspaces } from "../src/main/db/schema";
import { renameWorkspace } from "../src/main/services/workspace-service";
import { seedProject, seedWorkspace, setupTestDb, teardownTestDb } from "./helpers/db";

describe("renameWorkspace", () => {
	beforeEach(() => setupTestDb());
	afterEach(() => teardownTestDb());

	test("updates the display name", async () => {
		const p = await seedProject();
		const id = await seedWorkspace(p, { name: "old-name" });
		await renameWorkspace({ projectId: p, workspaceId: id }, { workspaceId: id, name: "new-name" });
		const row = getDb().select().from(workspaces).where(eq(workspaces.id, id)).get();
		expect(row?.name).toBe("new-name");
	});

	test("rejects empty name", async () => {
		const p = await seedProject();
		const id = await seedWorkspace(p, { name: "x" });
		await expect(
			renameWorkspace({ projectId: p, workspaceId: id }, { workspaceId: id, name: "   " })
		).rejects.toThrow(/empty/i);
	});

	test("rejects duplicate name within the same project", async () => {
		const p = await seedProject();
		await seedWorkspace(p, { name: "alpha" });
		const beta = await seedWorkspace(p, { name: "beta" });
		await expect(
			renameWorkspace({ projectId: p, workspaceId: beta }, { workspaceId: beta, name: "alpha" })
		).rejects.toThrow(/already in use/i);
	});

	test("allows duplicate name across different projects", async () => {
		const p1 = await seedProject();
		const p2 = await seedProject();
		await seedWorkspace(p1, { name: "shared" });
		const id = await seedWorkspace(p2, { name: "other" });
		await expect(
			renameWorkspace({ projectId: p2, workspaceId: id }, { workspaceId: id, name: "shared" })
		).resolves.toBeDefined();
	});

	test("rejects cross-project rename", async () => {
		const p1 = await seedProject();
		const p2 = await seedProject();
		const caller = await seedWorkspace(p1, { name: "caller" });
		const victim = await seedWorkspace(p2, { name: "victim" });
		await expect(
			renameWorkspace(
				{ projectId: p1, workspaceId: caller },
				{ workspaceId: victim, name: "pwned" }
			)
		).rejects.toThrow(/forbidden: cross-project/);
	});
});
