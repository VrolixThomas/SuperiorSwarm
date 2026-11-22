import { beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { fixProjectHook } from "../src/main/activity-queue/hook-actions";
import { readQueueHookConfig } from "../src/main/activity-queue/hook-config";
import {
	projectHookSourceId,
	refreshProjectHookQueue,
	setProjectHooksEnabled,
	trustProjectHooks,
} from "../src/main/activity-queue/hook-source";
import { ActivityQueueService } from "../src/main/activity-queue/service";
import { getDb } from "../src/main/db";
import { projects } from "../src/main/db/schema";
import { seedProject, seedWorkspace, setupTestDb } from "./helpers/db";
beforeAll(setupTestDb);
for (const when of ["before", "during"] as const)
	test(`a hook dismissed ${when} confirmation must not launch a fix`, async () => {
		const root = mkdtempSync(join(tmpdir(), "ss-review-hook-race-"));
		try {
			const projectId = await seedProject();
			getDb()
				.update(projects)
				.set({ repoPath: root, kind: "folder" })
				.where(eq(projects.id, projectId))
				.run();
			mkdirSync(join(root, ".superiorswarm"));
			writeFileSync(
				join(root, ".superiorswarm/queue.yml"),
				'hooks: [{id: check, title: Check, run: "cat output.jsonl"}]'
			);
			writeFileSync(
				join(root, "output.jsonl"),
				JSON.stringify({ key: "test", title: "Fail", why: "Failure", fixPrompt: "Fix this test" })
			);
			setProjectHooksEnabled(true);
			trustProjectHooks(projectId, readQueueHookConfig(root).hash);
			await refreshProjectHookQueue(projectId, true);
			const workspaceId = await seedWorkspace(projectId, { name: "root", type: "branch" });
			const queue = new ActivityQueueService();
			const id = projectHookSourceId(projectId, "check", "test");
			const revision = queue.read(id)!.revision;
			let dispatched = 0;
			let confirmations = 0;
			if (when === "before") queue.acknowledge({ id, revision });
			const result = await fixProjectHook(
				{ id, revision, workspaceId },
				{
					confirm: async () => {
						confirmations++;
						queue.acknowledge({ id, revision });
						return true;
					},
					spawn: async () => {
						dispatched++;
						return { status: "started", sessionId: "test", terminalId: "test" };
					},
				}
			).catch((e) => ({ status: "rejected", message: e.message }));
			expect(dispatched).toBe(0);
			expect(result.status).toBe("rejected");
			expect(confirmations).toBe(when === "before" ? 0 : 1);
		} finally {
			setProjectHooksEnabled(false);
			rmSync(root, { recursive: true, force: true });
		}
	});
