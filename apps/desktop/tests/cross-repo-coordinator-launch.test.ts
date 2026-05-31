import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	getCoordinatorLaunch,
	getCrossRepoOrchestrator,
	markAgentStarted,
} from "../src/main/services/cross-repo-orchestrators";
import { seedCrossRepoOrchestrator, setupTestDb, teardownTestDb } from "./helpers/db";

describe("coordinator launch", () => {
	beforeEach(() => setupTestDb());
	afterEach(() => teardownTestDb());

	test("getCoordinatorLaunch builds the CLI command for the agent kind", async () => {
		const xro = await seedCrossRepoOrchestrator({ agentKind: "claude", workDir: "/tmp/xro-abc" });
		const launch = await getCoordinatorLaunch({ id: xro });
		expect(launch.cwd).toBe("/tmp/xro-abc");
		expect(launch.command).toBe("claude --dangerously-skip-permissions");
	});

	test("getCoordinatorLaunch uses gemini preset flags", async () => {
		const xro = await seedCrossRepoOrchestrator({ agentKind: "gemini", workDir: "/tmp/xro-g" });
		const launch = await getCoordinatorLaunch({ id: xro });
		expect(launch.command).toBe("gemini --yolo");
	});

	test("markAgentStarted flips status to working", async () => {
		const xro = await seedCrossRepoOrchestrator({ agentKind: "claude" });
		await markAgentStarted({ id: xro });
		const row = await getCrossRepoOrchestrator({ id: xro });
		expect(row?.status).toBe("working");
	});
});
