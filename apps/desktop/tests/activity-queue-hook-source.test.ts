import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import {
	exactProjectHook,
	fixProjectHook,
	projectHookFixTargets,
} from "../src/main/activity-queue/hook-actions";
import {
	parseQueueHookConfig,
	parseQueueHookOutput,
	readQueueHookConfig,
} from "../src/main/activity-queue/hook-config";
import { runQueueHook } from "../src/main/activity-queue/hook-process";
import {
	describeProjectHookQueueItem,
	getProjectHookQueueErrors,
	isProjectHookQueueItemCurrent,
	listProjectHookStatus,
	projectHookSourceId,
	refreshProjectHookQueue,
	revokeProjectHookTrust,
	setProjectHooksEnabled,
	trustProjectHooks,
} from "../src/main/activity-queue/hook-source";
import { ActivityQueueService } from "../src/main/activity-queue/service";
import { getDb } from "../src/main/db";
import { appSettings, projects, workspaces } from "../src/main/db/schema";
import { activityQueueSources } from "../src/main/db/schema-activity-queue";
import { seedProject, seedWorkspace, setupTestDb } from "./helpers/db";

const temp = mkdtempSync(join(tmpdir(), "queue-hooks-test-"));
let projectId: string;
let root: string;
const row = {
	key: "tests",
	title: "Tests failing",
	why: "Two integration checks failed",
	fixPrompt: "Investigate tests; do not interpolate $(touch unsafe).",
};
const queue = () => new ActivityQueueService();
const sourceId = () => projectHookSourceId(projectId, "checks", "tests");
function config(command = "cat results.jsonl", extra = "") {
	writeFileSync(
		join(root, ".superiorswarm/queue.yml"),
		`hooks:\n  - id: checks\n    title: Project checks\n    every: 5m\n    run: ${JSON.stringify(command)}\n${extra}`
	);
}
function trust() {
	const status = readQueueHookConfig(root);
	trustProjectHooks(projectId, status.hash);
}
function output(rows = [row]) {
	writeFileSync(join(root, "results.jsonl"), rows.map((value) => JSON.stringify(value)).join("\n"));
}
beforeAll(setupTestDb);
beforeEach(async () => {
	setProjectHooksEnabled(false);
	getDb().delete(activityQueueSources).run();
	getDb().delete(appSettings).run();
	projectId = await seedProject();
	root = mkdtempSync(join(temp, "project-"));
	mkdirSync(join(root, ".superiorswarm"));
	getDb()
		.update(projects)
		.set({ repoPath: root, kind: "folder" })
		.where(eq(projects.id, projectId))
		.run();
	config();
	output();
});
afterAll(() => {
	setProjectHooksEnabled(false);
	rmSync(temp, { recursive: true, force: true });
});

test("config rejects duplicate ids/keys, aliases, unknown fields, oversized input", () => {
	expect(parseQueueHookConfig('hooks: [{id: a, title: Check, run: "echo ok"}]')[0]?.every).toBe(
		"5m"
	);
	for (const value of [
		"hooks: [{id: a, title: A, run: x}, {id: a, title: B, run: y}]",
		"hooks: []\nhooks: []",
		"hooks: &a []\nother: *a",
		"hooks: [{id: a, title: A, run: x, every: 1s}]",
		"x".repeat(65_537),
	])
		expect(() => parseQueueHookConfig(value)).toThrow();
});
test("JSONL validates complete batch, duplicate keys, safe URL schemes and bounds", () => {
	expect(parseQueueHookOutput(`${JSON.stringify(row)}\n`)).toEqual([row]);
	for (const value of [
		`${JSON.stringify(row)}\ninvalid`,
		`${JSON.stringify(row)}\n${JSON.stringify(row)}`,
		JSON.stringify({ ...row, url: "javascript:alert(1)" }),
		JSON.stringify({ ...row, why: "x".repeat(4001) }),
		" ".repeat(65_537),
	])
		expect(() => parseQueueHookOutput(value)).toThrow();
});
test("disabled and untrusted configurations never execute", async () => {
	config("touch executed");
	await refreshProjectHookQueue(projectId, true);
	setProjectHooksEnabled(true);
	await refreshProjectHookQueue(projectId, true);
	expect(existsSync(join(root, "executed"))).toBe(false);
	trust();
	await refreshProjectHookQueue(projectId, true);
	expect(existsSync(join(root, "executed"))).toBe(true);
});
test("identical complete output preserves receipts; changed output reopens; empty success resolves", async () => {
	setProjectHooksEnabled(true);
	trust();
	await refreshProjectHookQueue(projectId, true);
	const first = queue().read(sourceId())!;
	queue().acknowledge({ id: sourceId(), revision: first.revision });
	await refreshProjectHookQueue(projectId, true);
	expect(queue().read(sourceId())?.revision).toBe(first.revision);
	expect(queue().list().items).toHaveLength(0);
	output([{ ...row, why: "Three checks failed" }]);
	await refreshProjectHookQueue(projectId, true);
	expect(queue().list().items).toHaveLength(1);
	output([]);
	await refreshProjectHookQueue(projectId, true);
	expect(queue().read(sourceId())?.candidate).toBeNull();
});
test("malformed and nonzero runs preserve every prior item, with safe error messages", async () => {
	setProjectHooksEnabled(true);
	trust();
	await refreshProjectHookQueue(projectId, true);
	const first = queue().read(sourceId())!;
	writeFileSync(
		join(root, "results.jsonl"),
		`${JSON.stringify({ ...row, why: "partial change" })}\n{`
	);
	await refreshProjectHookQueue(projectId, true);
	expect(queue().read(sourceId())?.revision).toBe(first.revision);
	expect(queue().read(sourceId())?.candidate).toEqual(first.candidate);
	config("printf secret-token >&2; exit 2");
	trust();
	await refreshProjectHookQueue(projectId, true);
	expect(queue().read(sourceId())?.candidate).toEqual(first.candidate);
	expect(JSON.stringify(listProjectHookStatus())).not.toContain("secret-token\\n");
	expect(queue().read(sourceId())?.error).not.toContain("secret-token");
});
test("trust pins exact bytes and canonical working root; changing either requires review", async () => {
	setProjectHooksEnabled(true);
	trust();
	const before = readQueueHookConfig(root);
	config("touch should-not-run");
	expect(() => trustProjectHooks(projectId, before.hash)).toThrow();
	await refreshProjectHookQueue(projectId, true);
	expect(existsSync(join(root, "should-not-run"))).toBe(false);
	trust();
	const other = mkdtempSync(join(temp, "moved-"));
	mkdirSync(join(other, ".superiorswarm"));
	writeFileSync(
		join(other, ".superiorswarm/queue.yml"),
		readFileSync(join(root, ".superiorswarm/queue.yml"))
	);
	getDb().update(projects).set({ repoPath: other }).where(eq(projects.id, projectId)).run();
	await refreshProjectHookQueue(projectId, true);
	expect(existsSync(join(other, "should-not-run"))).toBe(false);
});
test("overlapping requests execute a project only once; revocation cancels and retains old items", async () => {
	setProjectHooksEnabled(true);
	trust();
	await refreshProjectHookQueue(projectId, true);
	config("echo start >> runs; sleep 0.2; cat results.jsonl");
	trust();
	const running = refreshProjectHookQueue(projectId, true);
	await Promise.all([
		refreshProjectHookQueue(projectId, true),
		refreshProjectHookQueue(projectId, true),
	]);
	await running;
	expect(readFileSync(join(root, "runs"), "utf8").trim().split("\n")).toHaveLength(1);
	config("sleep 10");
	trust();
	const cancelled = refreshProjectHookQueue(projectId, true);
	revokeProjectHookTrust(projectId);
	await cancelled;
	expect(queue().read(sourceId())?.candidate).not.toBeNull();
});
test("changed config during a run cannot resolve old items", async () => {
	setProjectHooksEnabled(true);
	trust();
	await refreshProjectHookQueue(projectId, true);
	config("sleep 0.1");
	trust();
	const running = refreshProjectHookQueue(projectId, true);
	config("printf '' # replacement");
	await running;
	expect(queue().read(sourceId())?.candidate).not.toBeNull();
});
test("timeout, stdout and stderr limits fail closed and do not expose stderr", async () => {
	const timed = await runQueueHook("sleep 10", root, undefined, { timeoutMs: 50 });
	expect(timed).toEqual({ ok: false, error: "Hook exceeded its time limit." });
	expect((await runQueueHook("yes x", root, undefined, { outputBytes: 100 })).ok).toBe(false);
	const stderr = await runQueueHook("yes secret >&2", root, undefined, { outputBytes: 100 });
	expect(stderr.ok).toBe(false);
	expect(JSON.stringify(stderr)).not.toContain("secret");
});
test("background children are killed after successful shell completion", async () => {
	const result = await runQueueHook("(sleep 0.3; touch leaked) >/dev/null 2>&1 & printf ''", root);
	expect(result.ok).toBe(true);
	await new Promise((resolve) => setTimeout(resolve, 400));
	expect(existsSync(join(root, "leaked"))).toBe(false);
});
test("project/hook/key identity separates duplicate names and escaping, aggregates repo/folder orchestrators", async () => {
	setProjectHooksEnabled(true);
	trust();
	await refreshProjectHookQueue(projectId, true);
	await seedWorkspace(projectId, { name: "one", isOrchestrator: true });
	await seedWorkspace(projectId, { name: "two", isOrchestrator: true });
	await refreshProjectHookQueue(projectId, true);
	expect(queue().list().items).toHaveLength(1);
	const second = await seedProject();
	const alias = join(temp, `alias-${second}`);
	symlinkSync(root, alias);
	getDb()
		.update(projects)
		.set({ name: "duplicate", repoPath: alias })
		.where(eq(projects.id, second))
		.run();
	await refreshProjectHookQueue(second, true);
	expect(queue().list().items).toHaveLength(1); // Trust is not shared across project IDs, even same physical path.
	trustProjectHooks(second, readQueueHookConfig(alias).hash);
	await refreshProjectHookQueue(second, true);
	expect(queue().list().items).toHaveLength(2);
	expect(projectHookSourceId("a:b", "c", "d")).not.toBe(projectHookSourceId("a", "b:c", "d"));
	expect(describeProjectHookQueueItem(queue().list().items[0]!)?.nextAction).toContain("fix");
	setProjectHooksEnabled(false);
	expect(isProjectHookQueueItemCurrent(queue().list().items[0]!)).toBe(false);
});
test("Open never acknowledges; Fix confirms exact revision/root and retains queue receipt", async () => {
	setProjectHooksEnabled(true);
	trust();
	await refreshProjectHookQueue(projectId, true);
	const workspaceId = await seedWorkspace(projectId, { name: "root", type: "branch" });
	const nested = await seedWorkspace(projectId, { name: "nested", type: "branch" });
	const child = join(root, "child");
	mkdirSync(child);
	getDb().update(workspaces).set({ folderPath: child }).where(eq(workspaces.id, nested)).run();
	const receipt = { id: sourceId(), revision: queue().read(sourceId())!.revision };
	exactProjectHook(receipt);
	expect(queue().list().items).toHaveLength(1);
	expect(projectHookFixTargets(receipt).map((value) => value.id)).toEqual([workspaceId]);
	let dispatched = 0;
	const deps = {
		confirm: async () => true,
		dispatch: async (input: { prompt: string; skipPermissions?: boolean }) => {
			expect(input.prompt).toBe(row.fixPrompt);
			expect(input.skipPermissions).toBe(false);
			dispatched++;
			return { sessionId: "fixture", terminalId: "fixture", status: "started" as const };
		},
	};
	expect(await fixProjectHook({ ...receipt, workspaceId }, deps)).toEqual({ status: "started" });
	expect(dispatched).toBe(1);
	expect(queue().list().items).toHaveLength(1);
	await expect(
		fixProjectHook({ ...receipt, revision: receipt.revision + 1, workspaceId }, deps)
	).rejects.toThrow();
	await expect(
		fixProjectHook(
			{ ...receipt, workspaceId },
			{
				...deps,
				confirm: async () => {
					revokeProjectHookTrust(projectId);
					return true;
				},
			}
		)
	).rejects.toThrow();
	expect(dispatched).toBe(1);
});

test("first-run failure is visible without a candidate and successful recovery clears the error", async () => {
	config("cat absent-results.jsonl");
	setProjectHooksEnabled(true);
	trust();
	await refreshProjectHookQueue(projectId, true);
	expect(queue().list().items).toHaveLength(0);
	expect(
		getProjectHookQueueErrors().find((value) => value.sourceId.includes(projectId))?.error
	).toContain("Hook failed");
	config();
	trust();
	await refreshProjectHookQueue(projectId, true);
	expect(
		getProjectHookQueueErrors().filter((value) => value.sourceId.includes(projectId))
	).toHaveLength(0);
});

test("metadata-only config changes retain Done; removing hooks requires renewed trust before retirement", async () => {
	setProjectHooksEnabled(true);
	trust();
	await refreshProjectHookQueue(projectId, true);
	const first = queue().read(sourceId());
	if (!first) throw Error("Missing fixture");
	queue().acknowledge({ id: sourceId(), revision: first.revision });
	config("cat results.jsonl", "# formatting-only change");
	trust();
	await refreshProjectHookQueue(projectId, true);
	expect(queue().read(sourceId())?.revision).toBe(first.revision);
	expect(queue().list().items).toHaveLength(0);
	writeFileSync(join(root, ".superiorswarm/queue.yml"), "hooks: []\n");
	await refreshProjectHookQueue(projectId, true);
	expect(queue().read(sourceId())?.candidate).not.toBeNull();
	trust();
	await refreshProjectHookQueue(projectId, true);
	expect(queue().read(sourceId())?.candidate).toBeNull();
});
