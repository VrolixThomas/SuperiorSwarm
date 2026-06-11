import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { getSettings } from "../src/main/ai-review/orchestrator";
import {
	getCoordinatorLaunch,
	getCrossRepoOrchestrator,
	markAgentStarted,
} from "../src/main/services/cross-repo-orchestrators";
import { seedCrossRepoOrchestrator, setupTestDb, teardownTestDb } from "./helpers/db";

type Settings = ReturnType<typeof getSettings>;
const skipOn = () => ({ skipPermissions: 1 }) as unknown as Settings;
const skipOff = () => ({ skipPermissions: 0 }) as unknown as Settings;

describe("coordinator launch", () => {
	beforeEach(() => setupTestDb());
	afterEach(() => teardownTestDb());

	test("getCoordinatorLaunch builds the CLI command for the agent kind", async () => {
		const xro = await seedCrossRepoOrchestrator({ agentKind: "claude", workDir: "/tmp/xro-abc" });
		const launch = await getCoordinatorLaunch({ id: xro }, { getSettingsFn: skipOn });
		expect(launch.cwd).toBe("/tmp/xro-abc");
		expect(launch.command).toBe("claude --dangerously-skip-permissions");
	});

	test("getCoordinatorLaunch uses gemini preset flags", async () => {
		const xro = await seedCrossRepoOrchestrator({ agentKind: "gemini", workDir: "/tmp/xro-g" });
		const launch = await getCoordinatorLaunch({ id: xro }, { getSettingsFn: skipOn });
		expect(launch.command).toBe("gemini --yolo");
	});

	test("coordinator launch omits permission flag when skipPermissions is off", async () => {
		const xro = await seedCrossRepoOrchestrator({});
		const { command } = await getCoordinatorLaunch({ id: xro }, { getSettingsFn: skipOff });
		expect(command).toBe("claude");
	});

	test("coordinator launch includes permission flag when skipPermissions is on", async () => {
		const xro = await seedCrossRepoOrchestrator({});
		const { command } = await getCoordinatorLaunch({ id: xro }, { getSettingsFn: skipOn });
		expect(command).toBe("claude --dangerously-skip-permissions");
	});

	test("markAgentStarted flips status to working", async () => {
		const xro = await seedCrossRepoOrchestrator({ agentKind: "claude" });
		await markAgentStarted({ id: xro });
		const row = await getCrossRepoOrchestrator({ id: xro });
		expect(row?.status).toBe("working");
	});
});
