import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventBus } from "../src/main/control-plane/event-bus";
import {
	attachOrchestratorEventSink,
	crossRepoEventsFilePath,
	invalidateCrossRepoLinksCache,
	setEventsDir,
} from "../src/main/control-plane/orchestrator-event-sink";
import { attachToCrossRepoOrchestrator } from "../src/main/services/cross-repo-orchestrator-membership";
import {
	seedCrossRepoOrchestrator,
	seedExternalManager,
	seedProject,
	seedWorkspace,
	setupTestDb,
	teardownTestDb,
} from "./helpers/db";

interface EventEnvelopeFixture {
	seq: number;
	schemaVersion: number;
	streamEpoch: string;
	eventId: string;
	projectId: string;
	occurredAt: string;
	workspaceId: string;
	ownedByRecipient?: boolean;
}

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

		bus.emit(p, {
			event: "status",
			workspaceId: "ws-x",
			phase: "working",
			statusText: null,
			needs: null,
			ts: "now",
		});

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

		bus.emit(p2, {
			event: "status",
			workspaceId: "ws-other",
			phase: "idle",
			statusText: null,
			needs: null,
			ts: "now",
		});

		const file = crossRepoEventsFilePath(xroId);
		expect(existsSync(file)).toBe(false);
	});

	test("all-scope managers receive events for a project registered after provisioning", async () => {
		const manager = await seedExternalManager({ accessScope: "all" });
		const futureProject = await seedProject();

		bus.emit(futureProject, {
			event: "status",
			workspaceId: "ws-future",
			phase: "working",
			statusText: null,
			needs: null,
			ts: "now",
		});

		expect(readFileSync(crossRepoEventsFilePath(manager.id), "utf-8")).toContain("ws-future");
	});

	test("single event reaches multiple cross-repo orchestrators that link the same project", async () => {
		const p = await seedProject();
		const xro1 = await seedCrossRepoOrchestrator({ projectIds: [p] });
		const xro2 = await seedCrossRepoOrchestrator({ projectIds: [p] });
		invalidateCrossRepoLinksCache(p);

		bus.emit(p, {
			event: "status",
			workspaceId: "ws-y",
			phase: "done",
			statusText: null,
			needs: null,
			ts: "now",
		});

		expect(readFileSync(crossRepoEventsFilePath(xro1), "utf-8")).toContain("ws-y");
		expect(readFileSync(crossRepoEventsFilePath(xro2), "utf-8")).toContain("ws-y");
	});

	test("writes versioned monotonic envelopes and preserves one event id across fan-out", async () => {
		const p = await seedProject();
		const xro1 = await seedCrossRepoOrchestrator({ projectIds: [p] });
		const xro2 = await seedCrossRepoOrchestrator({ projectIds: [p] });
		invalidateCrossRepoLinksCache(p);

		for (const phase of ["working", "done"] as const) {
			bus.emit(p, {
				event: "status",
				workspaceId: "ws-versioned",
				phase,
				statusText: null,
				needs: null,
				ts: `time-${phase}`,
			});
		}

		const read = (id: string) =>
			readFileSync(crossRepoEventsFilePath(id), "utf-8")
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line) as EventEnvelopeFixture);
		const first = read(xro1);
		const second = read(xro2);
		expect(first.map((event) => event.seq)).toEqual([1, 2]);
		expect(second.map((event) => event.seq)).toEqual([1, 2]);
		expect(first[0]?.schemaVersion).toBe(2);
		expect(first[0]?.streamEpoch).toBe(first[1]?.streamEpoch);
		expect(second[0]?.streamEpoch).toBe(second[1]?.streamEpoch);
		expect(first.map((event) => event.eventId)).toEqual(second.map((event) => event.eventId));
		expect(first[0]?.projectId).toBe(p);
		expect(first[1]?.occurredAt).toBe("time-done");
	});

	test("marks only explicitly attached child events as owned by the receiving manager", async () => {
		const p = await seedProject();
		const xro = await seedCrossRepoOrchestrator({ projectIds: [p] });
		const owned = await seedWorkspace(p, { name: "owned-child" });
		const unrelated = await seedWorkspace(p, { name: "unrelated-child" });
		await attachToCrossRepoOrchestrator({ orchestratorId: xro, workspaceId: owned });
		invalidateCrossRepoLinksCache(p);

		for (const workspaceId of [owned, unrelated]) {
			bus.emit(p, {
				event: "status",
				workspaceId,
				phase: "working",
				statusText: null,
				needs: null,
				ts: "now",
			});
		}

		const events = readFileSync(crossRepoEventsFilePath(xro), "utf-8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as EventEnvelopeFixture);
		expect(events.map((event) => [event.workspaceId, event.ownedByRecipient])).toEqual([
			[owned, true],
			[unrelated, false],
		]);
	});

	test("a failing xro events file does not block later xros", async () => {
		const p = await seedProject();
		const xroBad = await seedCrossRepoOrchestrator({ projectIds: [p] });
		const xroGood = await seedCrossRepoOrchestrator({ projectIds: [p] });
		invalidateCrossRepoLinksCache(p);

		// Make the BAD xro's events path unwritable: create a DIRECTORY at its file path.
		mkdirSync(crossRepoEventsFilePath(xroBad), { recursive: true });

		bus.emit(p, {
			event: "status",
			workspaceId: "w",
			phase: "working",
			statusText: null,
			needs: null,
			ts: new Date().toISOString(),
		});

		const goodContent = readFileSync(crossRepoEventsFilePath(xroGood), "utf-8");
		expect(goodContent).toContain('"status"');
	});
});
