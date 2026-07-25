import "./preload-electron-mock";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { getOrCreateAgentNotifyToken } from "../src/main/agent-hooks/auth-token";
import { _setDbForTesting, getDb } from "../src/main/db";
import * as schema from "../src/main/db/schema";
import { savePaneLayouts, saveTerminalSessions } from "../src/main/db/session-persistence";
import {
	getAgentSleepSettings,
	setAgentSleepSettings,
} from "../src/main/services/agent-sleep-settings";
import { makeRawTestDb } from "./test-db";

const raw = makeRawTestDb();
const isolatedDb = drizzle(raw, { schema });
const previousDb = getDb();

beforeAll(() => {
	_setDbForTesting(isolatedDb);
});

afterAll(() => {
	_setDbForTesting(previousDb);
	raw.close();
});

describe("session persistence diffing", () => {
	test("keeps the hook token stable for daemon-owned terminals across restarts", () => {
		const first = getOrCreateAgentNotifyToken();
		const second = getOrCreateAgentNotifyToken();
		expect(first).toMatch(/^[a-f0-9]{64}$/);
		expect(second).toBe(first);
	});

	test("keeps automatic agent sleep opt-in and persists its controls", () => {
		expect(getAgentSleepSettings()).toEqual({
			enabled: false,
			idleMinutes: 15,
			keepOrchestratorsAwake: true,
		});
		setAgentSleepSettings({
			enabled: true,
			idleMinutes: 30,
			keepOrchestratorsAwake: false,
		});
		expect(getAgentSleepSettings()).toEqual({
			enabled: true,
			idleMinutes: 30,
			keepOrchestratorsAwake: false,
		});
	});

	test("unchanged terminal metadata preserves daemon-owned recency and scrollback", () => {
		const old = new Date("2024-01-01T00:00:00Z");
		isolatedDb
			.insert(schema.terminalSessions)
			.values({
				id: "term-1",
				workspaceId: "ws-1",
				title: "Terminal",
				cwd: "/repo",
				scrollback: "valuable output",
				sortOrder: 0,
				updatedAt: old,
			})
			.run();

		saveTerminalSessions({
			sessions: [
				{
					id: "term-1",
					workspaceId: "ws-1",
					title: "Terminal",
					cwd: "/repo",
					sortOrder: 0,
				},
			],
			state: {},
		});
		let row = isolatedDb
			.select()
			.from(schema.terminalSessions)
			.where(eq(schema.terminalSessions.id, "term-1"))
			.get();
		expect(row?.updatedAt.getTime()).toBe(old.getTime());
		expect(row?.scrollback).toBe("valuable output");

		saveTerminalSessions({
			sessions: [
				{
					id: "term-1",
					workspaceId: "ws-1",
					title: "Renamed",
					cwd: "/repo",
					sortOrder: 0,
				},
			],
			state: {},
		});
		row = isolatedDb
			.select()
			.from(schema.terminalSessions)
			.where(eq(schema.terminalSessions.id, "term-1"))
			.get();
		expect(row?.title).toBe("Renamed");
		expect(row?.updatedAt.getTime()).toBe(old.getTime());
		expect(row?.scrollback).toBe("valuable output");
	});

	test("pane layouts update only on change and remove absent layouts", () => {
		const old = new Date("2024-01-01T00:00:00Z");
		isolatedDb
			.insert(schema.paneLayouts)
			.values([
				{ workspaceId: "ws-1", layout: '{"same":true}', updatedAt: old },
				{ workspaceId: "stale", layout: "{}", updatedAt: old },
			])
			.run();

		savePaneLayouts({ "ws-1": '{"same":true}' });
		const unchanged = isolatedDb
			.select()
			.from(schema.paneLayouts)
			.where(eq(schema.paneLayouts.workspaceId, "ws-1"))
			.get();
		expect(unchanged?.updatedAt.getTime()).toBe(old.getTime());
		expect(
			isolatedDb
				.select()
				.from(schema.paneLayouts)
				.where(eq(schema.paneLayouts.workspaceId, "stale"))
				.get()
		).toBeUndefined();

		savePaneLayouts({ "ws-1": '{"same":false}' });
		const changed = isolatedDb
			.select()
			.from(schema.paneLayouts)
			.where(eq(schema.paneLayouts.workspaceId, "ws-1"))
			.get();
		expect(changed?.layout).toBe('{"same":false}');
		expect(changed?.updatedAt.getTime()).toBeGreaterThan(old.getTime());
	});

	test("diffs renderer state while preserving main-process keys", () => {
		isolatedDb
			.insert(schema.sessionState)
			.values([
				{ key: "renderer-unchanged", value: "same" },
				{ key: "renderer-stale", value: "remove" },
				{ key: "lastSeenVersion", value: "0.13.0" },
				{ key: "supabase_session:user", value: "secret" },
			])
			.run();

		saveTerminalSessions({
			sessions: [],
			state: {
				"renderer-unchanged": "same",
				"renderer-new": "new",
			},
		});

		const state = Object.fromEntries(
			isolatedDb
				.select()
				.from(schema.sessionState)
				.all()
				.map((row) => [row.key, row.value])
		);
		expect(state).toEqual({
			"renderer-unchanged": "same",
			"renderer-new": "new",
			lastSeenVersion: "0.13.0",
			"supabase_session:user": "secret",
		});
	});
});
