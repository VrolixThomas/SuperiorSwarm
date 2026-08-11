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
		const ambiguousOperation = await request("manager-a", "/hermes.tags.definitions.list", {
			connectionId: "connection-a",
			metadata,
			query: "",
		});
		expect(ambiguousOperation.status).toBe(403);
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
		expect(await stale.json()).toEqual(
			expect.objectContaining({ error: "conflict", code: "revision_conflict" })
		);
		const read = await request("manager-a", "/hermes.sessions.tags.read", {
			connectionId: "connection-a",
			metadata,
		});
		expect(await read.json()).toEqual(expect.objectContaining({ tags: ["newer"], revision: 1 }));
	});

	test("manages reusable definitions and current-session assignments with semantic errors", async () => {
		const upsert = await request("manager-a", "/hermes.tags.definitions.upsert", {
			connectionId: "connection-a",
			metadata,
			name: " Needs review ",
			color: "amber",
		});
		expect(upsert.status).toBe(200);
		const upserted = (await upsert.json()) as {
			created: boolean;
			definition: { id: string; name: string; color: string; revision: number };
		};
		expect(upserted).toEqual(
			expect.objectContaining({
				created: true,
				definition: expect.objectContaining({ name: "Needs review", color: "amber", revision: 0 }),
			})
		);

		const idempotent = await request("manager-a", "/hermes.tags.definitions.upsert", {
			connectionId: "connection-a",
			metadata,
			name: "needs review",
			color: "blue",
		});
		expect(await idempotent.json()).toEqual(
			expect.objectContaining({
				created: false,
				definition: expect.objectContaining({
					id: upserted.definition.id,
					color: "amber",
					revision: 0,
				}),
			})
		);
		const other = (await (
			await request("manager-a", "/hermes.tags.definitions.upsert", {
				connectionId: "connection-a",
				metadata,
				name: "Other",
				color: "gray",
			})
		).json()) as { definition: { id: string } };
		const nameConflict = await request("manager-a", "/hermes.tags.definitions.update", {
			connectionId: "connection-a",
			metadata,
			definitionId: other.definition.id,
			name: "NEEDS REVIEW",
			expectedRevision: 0,
		});
		expect(nameConflict.status).toBe(409);
		expect(await nameConflict.json()).toEqual(
			expect.objectContaining({ error: "conflict", code: "tag_name_conflict" })
		);

		const listA = await request("manager-a", "/hermes.tags.definitions.list", {
			connectionId: "connection-a",
			metadata,
			query: "review",
		});
		expect(await listA.json()).toEqual(
			expect.objectContaining({
				definitions: [
					expect.objectContaining({ id: upserted.definition.id, name: "Needs review" }),
				],
			})
		);
		const listB = await request("manager-b", "/hermes.tags.definitions.list", {
			connectionId: "connection-b",
			metadata,
			query: "",
		});
		expect(await listB.json()).toEqual(expect.objectContaining({ definitions: [] }));

		const assigned = await request("manager-a", "/hermes.sessions.tags.assign", {
			connectionId: "connection-a",
			metadata,
			definitionId: upserted.definition.id,
		});
		expect(await assigned.json()).toEqual(
			expect.objectContaining({
				revision: 1,
				assignments: [
					expect.objectContaining({
						id: upserted.definition.id,
						name: "Needs review",
						color: "amber",
					}),
				],
			})
		);
		const readAssignments = await request("manager-a", "/hermes.sessions.tags.assignments.read", {
			connectionId: "connection-a",
			metadata,
		});
		expect(await readAssignments.json()).toEqual(
			expect.objectContaining({
				assignments: [expect.objectContaining({ id: upserted.definition.id })],
			})
		);

		const updated = await request("manager-a", "/hermes.tags.definitions.update", {
			connectionId: "connection-a",
			metadata,
			definitionId: upserted.definition.id,
			name: "Reviewed",
			color: "green",
			expectedRevision: 0,
		});
		expect(await updated.json()).toEqual(
			expect.objectContaining({ name: "Reviewed", color: "green", revision: 1 })
		);
		const stale = await request("manager-a", "/hermes.tags.definitions.update", {
			connectionId: "connection-a",
			metadata,
			definitionId: upserted.definition.id,
			color: "red",
			expectedRevision: 0,
		});
		expect(stale.status).toBe(409);
		expect(await stale.json()).toEqual(
			expect.objectContaining({ error: "conflict", code: "revision_conflict" })
		);

		const deleted = await request("manager-a", "/hermes.tags.definitions.delete", {
			connectionId: "connection-a",
			metadata,
			definitionId: upserted.definition.id,
			expectedRevision: 1,
		});
		expect(await deleted.json()).toEqual(expect.objectContaining({ detachedSessionCount: 1 }));
		expect(
			await (
				await request("manager-a", "/hermes.sessions.tags.assignments.read", {
					connectionId: "connection-a",
					metadata,
				})
			).json()
		).toEqual(expect.objectContaining({ assignments: [], revision: 2 }));
	});

	test("fails reusable operations closed for invalid palettes, keys, ownership, or admission", async () => {
		const invalidColor = await request("manager-a", "/hermes.tags.definitions.upsert", {
			connectionId: "connection-a",
			metadata,
			name: "Unsafe",
			color: "#ff0000",
		});
		expect(invalidColor.status).toBe(400);
		const extraKey = await request("manager-a", "/hermes.tags.definitions.list", {
			connectionId: "connection-a",
			metadata,
			query: "",
			sessionId: "arbitrary-target",
		});
		expect(extraKey.status).toBe(400);
		const wrongConnection = await request("manager-a", "/hermes.tags.definitions.list", {
			connectionId: "connection-b",
			metadata,
			query: "",
		});
		expect(wrongConnection.status).toBe(403);
		const unadmitted = await request("manager-a", "/hermes.sessions.tags.assignments.read", {
			connectionId: "connection-a",
			metadata: { ...metadata, durableSessionId: "not-admitted" },
		});
		expect(unadmitted.status).toBe(403);
		const missing = await request("manager-a", "/hermes.tags.definitions.update", {
			connectionId: "connection-a",
			metadata,
			definitionId: "missing-definition",
			color: "blue",
			expectedRevision: 0,
		});
		expect(missing.status).toBe(404);
		expect(await missing.json()).toEqual(expect.objectContaining({ error: "not_found" }));
	});
});
