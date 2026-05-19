import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	attachOrchestratorEventSink,
	crossRepoEventsFilePath,
	invalidateCrossRepoLinksCache,
	setEventsDir,
} from "../src/main/control-plane/orchestrator-event-sink";
import { EventBus } from "../src/main/control-plane/event-bus";
import {
	seedCrossRepoOrchestrator,
	seedProject,
	setupTestDb,
	teardownTestDb,
} from "./helpers/db";

describe("orchestrator-event-sink cross-repo aggregation", () => {
	let tmpDir: string;
	let bus: EventBus;
	let unsubscribe: () => void;

	beforeEach(() => {
		setupTestDb();
		tmpDir = mkdtempSync(join(tmpdir(), "xro-events-"));
		setEventsDir(tmpDir);
		bus = new EventBus();
		unsubscribe = attachOrchestratorEventSink(bus);
	});

	afterEach(() => {
		unsubscribe();
		teardownTestDb();
	});

	test("events for a linked project appear in that orchestrator's cross-repo jsonl", async () => {
		const p = await seedProject();
		const xroId = await seedCrossRepoOrchestrator({ projectIds: [p] });
		invalidateCrossRepoLinksCache(p);

		bus.emit(p, { event: "status", workspaceId: "ws-x", phase: "working", statusText: null, needs: null, ts: "now" });

		const file = crossRepoEventsFilePath(xroId);
		expect(existsSync(file)).toBe(true);
		const content = readFileSync(file, "utf-8");
		expect(content).toContain('"workspaceId":"ws-x"');
		expect(content).toContain('"phase":"working"');
	});

	test("events for an unlinked project do not appear", async () => {
		const p1 = await seedProject();
		const p2 = await seedProject();
		const xroId = await seedCrossRepoOrchestrator({ projectIds: [p1] });
		invalidateCrossRepoLinksCache(p1);
		invalidateCrossRepoLinksCache(p2);

		bus.emit(p2, { event: "status", workspaceId: "ws-other", phase: "idle", statusText: null, needs: null, ts: "now" });

		const file = crossRepoEventsFilePath(xroId);
		expect(existsSync(file)).toBe(false);
	});

	test("single event reaches multiple cross-repo orchestrators that link the same project", async () => {
		const p = await seedProject();
		const xro1 = await seedCrossRepoOrchestrator({ projectIds: [p] });
		const xro2 = await seedCrossRepoOrchestrator({ projectIds: [p] });
		invalidateCrossRepoLinksCache(p);

		bus.emit(p, { event: "status", workspaceId: "ws-y", phase: "done", statusText: null, needs: null, ts: "now" });

		expect(readFileSync(crossRepoEventsFilePath(xro1), "utf-8")).toContain("ws-y");
		expect(readFileSync(crossRepoEventsFilePath(xro2), "utf-8")).toContain("ws-y");
	});
});
