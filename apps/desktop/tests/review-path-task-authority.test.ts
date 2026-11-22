import { expect, test } from "bun:test";
import { hashToken } from "../src/main/control-plane/auth";
import { EventBus } from "../src/main/control-plane/event-bus";
import { createControlPlaneServer } from "../src/main/control-plane/server";
import { type TaskMode, TaskRegistry } from "../src/main/control-plane/task-registry";
import { _setDbForTesting } from "../src/main/db";
import { crossRepoOrchestrators } from "../src/main/db/schema";
import { inIsolatedFileBrowserTest } from "./helpers/isolated-file-browser-test";
import { agent, authorityFixture, identity } from "./helpers/review-path-authority-fixture";

if (
	inIsolatedFileBrowserTest(import.meta.path, "task-token authority across all bootstrap fallbacks")
) {
	test("supplied invalid task credentials never fall through; valid tasks and tokenless contexts retain their modes", async () => {
		const fixture = authorityFixture();
		_setDbForTesting(fixture.db);
		let now = 100;
		const registry = new TaskRegistry({ now: () => now, ttlMs: 10 });
		const server = createControlPlaneServer({
			token: "synthetic-control",
			taskRegistry: registry,
			eventBus: new EventBus(),
			confirm: async () => {
				throw Error("Unexpected confirmation");
			},
			spawnFn: async () => {
				throw Error("Unexpected spawn");
			},
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const address = server.address();
		if (!address || typeof address === "string") throw Error("Missing port");
		const base = `http://127.0.0.1:${address.port}/context.resolve`;
		const originalLog = console.log;
		console.log = () => {};
		try {
			const date = new Date();
			fixture.db
				.insert(crossRepoOrchestrators)
				.values({
					id: "manager",
					name: "Synthetic",
					workDir: fixture.root,
					agentKind: "codex",
					sortOrder: 0,
					kind: "external",
					tokenHash: hashToken("synthetic-manager"),
					createdAt: date,
					updatedAt: date,
				})
				.run();
			const run = fixture.storage.begin(identity, agent, ["a.ts"]);
			const modes: TaskMode[] = [
				"review-path",
				"review",
				"solve",
				"quick-action-setup",
				"workspace-agent",
				"none",
			];
			const request = async (
				token: string | undefined,
				cwd: string,
				extra: Record<string, string>
			) => {
				const query = new URLSearchParams({ cwd });
				if (token !== undefined) query.set("taskToken", token);
				const response = await fetch(`${base}?${query}`, {
					headers: { Authorization: "Bearer synthetic-control", ...extra },
				});
				return { status: response.status, body: await response.json() };
			};
			for (const mode of modes) {
				registry.register(mode, {
					mode,
					projectId: "p",
					workspaceId: "w",
					modeContext: { reviewPathRunId: run.id, reviewPathRunVersion: String(run.version) },
				});
				const first = await request(mode, fixture.root, {
					"x-workspace-id": "other",
					"x-manager-token": "synthetic-manager",
				});
				expect(first.status).toBe(200);
				expect(first.body.mode).toBe(mode);
				if (mode === "review-path")
					expect(
						fixture.storage.authenticateCapability(first.body.modeContext.reviewPathCapability).id
					).toBe(run.id);
				registry.register(`expired-${mode}`, {
					mode,
					projectId: "p",
					workspaceId: "w",
					modeContext: {},
				});
			}
			now += 10;
			const fallbackHeaders: Record<string, string>[] = [
				{},
				{ "x-workspace-id": "w" },
				{ "x-manager-token": "synthetic-manager" },
				{ "x-workspace-id": "w", "x-manager-token": "synthetic-manager" },
			];
			for (const token of ["", "unknown", ...modes, ...modes.map((mode) => `expired-${mode}`)])
				for (const cwd of [fixture.root, "/unknown"])
					for (const extra of fallbackHeaders) {
						const result = await request(token, cwd, extra);
						expect(result.status).toBe(403);
						expect(result.body.mode).toBeUndefined();
					}
			for (const [cwd, extra, mode] of [
				[fixture.root, {}, "workspace-agent"],
				["/unknown", { "x-workspace-id": "w" }, "workspace-agent"],
				["/unknown", { "x-manager-token": "synthetic-manager" }, "external-manager"],
				["/unknown", {}, "none"],
			] as const) {
				const result = await request(undefined, cwd, extra);
				expect(result.status).toBe(200);
				expect(result.body.mode).toBe(mode);
			}
		} finally {
			console.log = originalLog;
			await new Promise<void>((resolve) => server.close(() => resolve()));
			_setDbForTesting(null);
			fixture.close();
		}
	});
}
