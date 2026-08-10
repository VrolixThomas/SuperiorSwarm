import "./preload-electron-mock";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { _setDbForTesting, getDb, schema } from "../src/main/db";
import {
	admitHermesSession,
	filterManagedHermesSessionCatalog,
	listHermesSessionAdmissions,
} from "../src/main/hermes/hermes-session-admissions";
import type { HermesSessionSummary } from "../src/shared/hermes";
import { makeTestDb } from "./test-db";

function seedManager(id: string): void {
	const now = new Date();
	getDb()
		.insert(schema.crossRepoOrchestrators)
		.values({
			id,
			name: id,
			workDir: `/tmp/${id}`,
			agentKind: "external",
			status: "idle",
			sortOrder: 0,
			kind: "external",
			tokenHash: "a".repeat(64),
			accessScope: "all",
			createdAt: now,
			updatedAt: now,
		})
		.run();
}

function session(
	id: string,
	profileId: string,
	source: string,
	overrides: Partial<HermesSessionSummary> = {}
): HermesSessionSummary {
	return {
		id,
		title: id,
		preview: "",
		profileId,
		source,
		updatedAt: 1,
		createdAt: 1,
		archived: false,
		running: false,
		busy: false,
		waitingForUser: false,
		messageCount: 0,
		isCron: source === "cron",
		handover: false,
		admissionReason: null,
		origin:
			source === "superiorswarm"
				? null
				: {
						platform: source,
						source,
						displayLabel: source,
						workspaceLabel: null,
						accountLabel: null,
						chatLabel: null,
						channelLabel: null,
						threadLabel: null,
						hasThread: false,
						canOpenThread: false,
						canReport: false,
					},
		...overrides,
	};
}

describe("Hermes session admissions", () => {
	beforeEach(() => {
		_setDbForTesting(makeTestDb());
		seedManager("manager-a");
		seedManager("manager-b");
	});

	afterEach(() => {
		_setDbForTesting(null);
	});

	test("persists isolated identity and promotes handover without a later MCP downgrade", () => {
		const firstSeenAt = new Date("2026-08-09T10:00:00.000Z");
		const promotedAt = new Date("2026-08-09T10:05:00.000Z");
		const lastSeenAt = new Date("2026-08-09T10:10:00.000Z");
		for (const [managerId, profileId] of [
			["manager-a", "work"],
			["manager-a", "personal"],
			["manager-b", "work"],
		] as const) {
			admitHermesSession({
				managerId,
				metadata: {
					schemaVersion: 1,
					durableSessionId: "same-durable-id",
					profileId,
					sourcePlatform: "slack",
					isCron: false,
				},
				reason: managerId === "manager-b" ? "handover" : "mcp",
				now: firstSeenAt,
			});
		}

		const promotion = admitHermesSession({
			managerId: "manager-a",
			metadata: {
				schemaVersion: 1,
				durableSessionId: "same-durable-id",
				profileId: "work",
				sourcePlatform: "telegram",
				isCron: false,
			},
			reason: "handover",
			now: promotedAt,
		});
		const attemptedDowngrade = admitHermesSession({
			managerId: "manager-a",
			metadata: {
				schemaVersion: 1,
				durableSessionId: "same-durable-id",
				profileId: "work",
				sourcePlatform: "telegram",
				isCron: false,
			},
			reason: "mcp",
			now: lastSeenAt,
		});

		expect(promotion).toMatchObject({ admitted: true, reason: "handover" });
		expect(attemptedDowngrade).toMatchObject({ admitted: true, reason: "handover" });
		const rows = getDb().select().from(schema.hermesSessionAdmissions).all();
		expect(rows).toHaveLength(3);
		expect(listHermesSessionAdmissions("manager-a")).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					profileId: "work",
					durableSessionId: "same-durable-id",
					reason: "handover",
					sourcePlatform: "telegram",
					firstSeenAt,
					lastSeenAt,
				}),
				expect.objectContaining({ profileId: "personal" }),
			])
		);
		expect(listHermesSessionAdmissions("manager-b")).toEqual([
			expect.objectContaining({ reason: "handover", profileId: "work" }),
		]);
		expect(JSON.stringify(rows)).not.toContain("token");
	});

	test("refuses cron admission defensively", () => {
		const result = admitHermesSession({
			managerId: "manager-a",
			metadata: {
				schemaVersion: 1,
				durableSessionId: "scheduled-task",
				profileId: "work",
				sourcePlatform: "slack",
				isCron: true,
			},
			reason: "handover",
		});

		expect(result).toEqual({ admitted: false, code: "cron_session" });
		expect(
			admitHermesSession({
				managerId: "manager-a",
				metadata: {
					schemaVersion: 1,
					durableSessionId: "cron-source-task",
					profileId: "work",
					sourcePlatform: "cron",
					isCron: false,
				},
				reason: "mcp",
			})
		).toEqual({ admitted: false, code: "cron_session" });
		expect(listHermesSessionAdmissions("manager-a")).toEqual([]);
	});

	test("requires manager admission even when two installations share a superiorswarm source", () => {
		admitHermesSession({
			managerId: "manager-b",
			metadata: {
				schemaVersion: 1,
				durableSessionId: "other-installation-agent",
				profileId: "work",
				sourcePlatform: "superiorswarm",
				isCron: false,
			},
			reason: "agents",
		});

		expect(
			filterManagedHermesSessionCatalog({
				managerId: "manager-a",
				sessions: [session("other-installation-agent", "work", "superiorswarm")],
			})
		).toEqual([]);
		expect(
			filterManagedHermesSessionCatalog({
				managerId: "manager-b",
				sessions: [session("other-installation-agent", "work", "superiorswarm")],
			})
		).toEqual([
			expect.objectContaining({
				id: "other-installation-agent",
				admissionReason: "agents",
			}),
		]);
	});

	test("includes only manager-admitted agent, MCP, and explicit handover sessions", () => {
		admitHermesSession({
			managerId: "manager-a",
			metadata: {
				schemaVersion: 1,
				durableSessionId: "local-created",
				profileId: "default",
				sourcePlatform: "superiorswarm",
				isCron: false,
			},
			reason: "agents",
		});
		admitHermesSession({
			managerId: "manager-a",
			metadata: {
				schemaVersion: 1,
				durableSessionId: "external-mcp",
				profileId: "work",
				sourcePlatform: "telegram",
				isCron: false,
			},
			reason: "mcp",
		});
		admitHermesSession({
			managerId: "manager-a",
			metadata: {
				schemaVersion: 1,
				durableSessionId: "external-handover",
				profileId: "personal",
				sourcePlatform: "slack",
				isCron: false,
			},
			reason: "handover",
		});
		// Same durable/profile admission under another authenticated manager must not leak in.
		admitHermesSession({
			managerId: "manager-b",
			metadata: {
				schemaVersion: 1,
				durableSessionId: "other-manager-only",
				profileId: "work",
				sourcePlatform: "api_server",
				isCron: false,
			},
			reason: "mcp",
		});

		const filtered = filterManagedHermesSessionCatalog({
			managerId: "manager-a",
			sessions: [
				session("local-created", "default", "superiorswarm"),
				session("external-mcp", "work", "telegram"),
				session("external-handover", "personal", "slack"),
				session("unrelated-telegram", "work", "telegram"),
				session("unrelated-slack", "work", "slack"),
				session("unrelated-cli", "work", "cli"),
				session("unrelated-api", "work", "api_server"),
				session("other-manager-only", "work", "api_server"),
				session("cron-source", "work", "cron"),
				session("cron-flag", "work", "slack", { isCron: true }),
			],
		});

		expect(filtered.map((item) => item.id)).toEqual([
			"local-created",
			"external-mcp",
			"external-handover",
		]);
		expect(filtered.find((item) => item.id === "external-mcp")).toMatchObject({
			handover: false,
			admissionReason: "mcp",
			origin: { platform: "telegram" },
		});
		expect(filtered.find((item) => item.id === "external-handover")).toMatchObject({
			handover: true,
			admissionReason: "handover",
			origin: { platform: "slack" },
		});
	});
});
