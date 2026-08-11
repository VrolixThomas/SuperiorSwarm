import "./preload-electron-mock";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { startControlPlane } from "../src/main/control-plane";
import { generateToken, hashToken } from "../src/main/control-plane/auth";
import { _setDbForTesting, getDb, schema } from "../src/main/db";
import { admitHermesSession } from "../src/main/hermes/hermes-session-admissions";
import { makeTestDb } from "./test-db";

const metadata = {
	schemaVersion: 1 as const,
	durableSessionId: "shared-session",
	profileId: "work",
	sourcePlatform: "slack",
	isCron: false,
};

describe("Hermes session tag control plane", () => {
	let server: Awaited<ReturnType<typeof startControlPlane>>;
	const tokens = new Map<string, string>();

	function seedManager(id: string): void {
		const token = generateToken();
		tokens.set(id, token);
		const now = new Date();
		getDb()
			.insert(schema.crossRepoOrchestrators)
			.values({
				id,
				name: id,
				workDir: `/managers/${id}`,
				agentKind: "external",
				status: "idle",
				sortOrder: 0,
				kind: "external",
				tokenHash: hashToken(token),
				accessScope: "all",
				createdAt: now,
				updatedAt: now,
			})
			.run();
	}

	function seedConnection(id: string, managerId: string): void {
		const now = new Date();
		getDb()
			.insert(schema.hermesConnections)
			.values({
				id,
				label: id,
				baseUrl: `https://${id}.example.test`,
				profileId: "work",
				managerId,
				managerBindingMode: "manual",
				createdAt: now,
				updatedAt: now,
			})
			.run();
		admitHermesSession({ managerId, metadata, reason: "mcp" });
	}

	async function request(
		managerId: string,
		path: string,
		body: Record<string, unknown>
	): Promise<Response> {
		return await fetch(`http://127.0.0.1:${server.port}${path}`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${server.token}`,
				"X-Cross-Repo-Orchestrator-Id": managerId,
				"X-Manager-Token": tokens.get(managerId) ?? "",
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
		});
	}

	beforeEach(async () => {
		_setDbForTesting(makeTestDb());
		seedManager("manager-a");
		seedManager("manager-b");
		seedConnection("connection-a", "manager-a");
		seedConnection("connection-b", "manager-b");
		server = await startControlPlane({
			confirm: async () => true,
			spawnFn: async () => ({ sessionId: "session", terminalId: "terminal" }),
		});
	});

	afterEach(async () => {
		await server.stop();
		_setDbForTesting(null);
		tokens.clear();
	});

	test("resolves a unique authenticated manager connection and fails closed when ambiguous", async () => {
		const unique = await fetch(`http://127.0.0.1:${server.port}/context.resolve?cwd=/nowhere`, {
			headers: {
				Authorization: `Bearer ${server.token}`,
				"X-Manager-Token": tokens.get("manager-a") ?? "",
			},
		});
		expect(await unique.json()).toEqual(
			expect.objectContaining({
				mode: "external-manager",
				hermesConnectionId: "connection-a",
			})
		);

		seedConnection("connection-a-duplicate", "manager-a");
		const ambiguous = await fetch(`http://127.0.0.1:${server.port}/context.resolve?cwd=/nowhere`, {
			headers: {
				Authorization: `Bearer ${server.token}`,
				"X-Manager-Token": tokens.get("manager-a") ?? "",
			},
		});
		const ambiguousBody = (await ambiguous.json()) as Record<string, unknown>;
		expect(ambiguousBody["mode"]).toBe("external-manager");
		expect(ambiguousBody["hermesConnectionId"]).toBeUndefined();
	});

	test("validates operations and isolates equal sessions across manager plus connection", async () => {
		const setA = await request("manager-a", "/hermes.sessions.tags.set", {
			connectionId: "connection-a",
			metadata,
			tags: [" alpha ", "customer report", "alpha"],
			expectedRevision: 0,
		});
		expect(setA.status).toBe(200);
		expect(await setA.json()).toEqual(
			expect.objectContaining({
				tags: ["alpha", "customer report"],
				revision: 1,
				updatedAt: expect.any(Number),
			})
		);

		const addB = await request("manager-b", "/hermes.sessions.tags.add", {
			connectionId: "connection-b",
			metadata,
			tag: "beta",
		});
		expect(addB.status).toBe(200);
		const readA = await request("manager-a", "/hermes.sessions.tags.read", {
			connectionId: "connection-a",
			metadata,
		});
		const readB = await request("manager-b", "/hermes.sessions.tags.read", {
			connectionId: "connection-b",
			metadata,
		});
		expect(await readA.json()).toEqual(
			expect.objectContaining({ tags: ["alpha", "customer report"], revision: 1 })
		);
		expect(await readB.json()).toEqual(expect.objectContaining({ tags: ["beta"], revision: 1 }));

		const forbidden = await request("manager-a", "/hermes.sessions.tags.remove", {
			connectionId: "connection-b",
			metadata,
			tag: "beta",
		});
		expect(forbidden.status).toBe(403);
		const invalid = await request("manager-a", "/hermes.sessions.tags.add", {
			connectionId: "connection-a",
			metadata,
			tag: " ",
		});
		expect(invalid.status).toBe(400);

		const responseText = JSON.stringify(
			await (
				await request("manager-a", "/hermes.sessions.tags.read", {
					connectionId: "connection-a",
					metadata,
				})
			).json()
		);
		expect(responseText).not.toContain("transcript");
		expect(responseText).not.toContain("worktree");
		expect(responseText).not.toContain("token");
	});

	test("returns a conflict for stale set without losing the newer tags", async () => {
		await request("manager-a", "/hermes.sessions.tags.add", {
			connectionId: "connection-a",
			metadata,
			tag: "newer",
		});
		const stale = await request("manager-a", "/hermes.sessions.tags.set", {
			connectionId: "connection-a",
			metadata,
			tags: ["stale"],
			expectedRevision: 0,
		});
		expect(stale.status).toBe(409);
		expect(await stale.json()).toEqual(expect.objectContaining({ error: "conflict" }));
		const read = await request("manager-a", "/hermes.sessions.tags.read", {
			connectionId: "connection-a",
			metadata,
		});
		expect(await read.json()).toEqual(expect.objectContaining({ tags: ["newer"], revision: 1 }));
	});
});
