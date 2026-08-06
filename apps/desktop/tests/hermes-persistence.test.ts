import "./preload-electron-mock";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { _setDbForTesting, schema } from "../src/main/db";
import {
	deleteHermesConnection,
	getHermesConnectionWithToken,
	listHermesConnections,
	saveHermesConnection,
} from "../src/main/hermes/hermes-connections";
import { HermesTokenVault } from "../src/main/hermes/hermes-token-vault";
import {
	linkHermesWorkspace,
	listHermesWorkspaceLinks,
	unlinkHermesWorkspace,
} from "../src/main/hermes/hermes-workspace-links";
import { makeTestDb } from "./test-db";

describe("Hermes persistence services", () => {
	let db: ReturnType<typeof makeTestDb>;
	let vault: HermesTokenVault;

	beforeEach(() => {
		db = makeTestDb();
		_setDbForTesting(db);
		vault = new HermesTokenVault({
			isEncryptionAvailable: () => true,
			encryptString: (value) => Buffer.from(`ciphertext:${value}`),
			decryptString: (value) => value.toString().replace(/^ciphertext:/, ""),
		});
	});

	afterEach(() => {
		_setDbForTesting(null);
	});

	test("stores an encrypted token and returns only a redacted connection summary", () => {
		const connection = saveHermesConnection(
			{
				label: "Local Hermes",
				baseUrl: "http://127.0.0.1:8080",
				profileId: "default",
				token: "hermes-secret",
			},
			vault
		);

		const stored = db
			.select()
			.from(schema.hermesConnections)
			.where(eq(schema.hermesConnections.id, connection.id))
			.get();
		expect(stored?.encryptedToken).not.toBe("hermes-secret");
		expect(JSON.stringify(connection)).not.toContain("hermes-secret");
		expect(listHermesConnections()[0]?.hasToken).toBe(true);
		expect(getHermesConnectionWithToken(connection.id, vault)?.token).toBe("hermes-secret");
	});

	test("reports a memory-only token as available during the current process", () => {
		const memoryVault = new HermesTokenVault({
			isEncryptionAvailable: () => false,
			encryptString: () => Buffer.alloc(0),
			decryptString: () => "",
		});
		saveHermesConnection(
			{
				label: "Ephemeral",
				baseUrl: "http://localhost:8080",
				profileId: "default",
				token: "memory-secret",
			},
			memoryVault
		);

		expect(listHermesConnections(memoryVault)[0]?.hasToken).toBe(true);
		expect(JSON.stringify(listHermesConnections(memoryVault))).not.toContain("memory-secret");
	});

	test("accepts loopback only and deletes dependent link/report rows", () => {
		expect(() =>
			saveHermesConnection(
				{
					label: "Remote",
					baseUrl: "https://hermes.example.com",
					profileId: "default",
					token: "token",
				},
				vault
			)
		).toThrow("loopback");

		const connection = saveHermesConnection(
			{
				label: "Local",
				baseUrl: "ws://localhost:8080/api/ws",
				profileId: "default",
				token: "token",
			},
			vault
		);
		deleteHermesConnection(connection.id, vault);
		expect(listHermesConnections()).toEqual([]);
	});

	test("links multiple workspaces deterministically and retains deleted-workspace recovery state", () => {
		const now = new Date();
		db.insert(schema.projects)
			.values({
				id: "project-1",
				name: "App",
				repoPath: "/repos/app",
				defaultBranch: "main",
				createdAt: now,
				updatedAt: now,
			})
			.run();
		for (const workspaceId of ["workspace-1", "workspace-2"]) {
			db.insert(schema.workspaces)
				.values({
					id: workspaceId,
					projectId: "project-1",
					type: "worktree",
					name: workspaceId,
					createdAt: now,
					updatedAt: now,
				})
				.run();
		}
		const connection = saveHermesConnection(
			{
				label: "Local",
				baseUrl: "http://localhost:8080",
				profileId: "default",
				token: "token",
			},
			vault
		);

		const first = linkHermesWorkspace({
			connectionId: connection.id,
			hermesSessionId: "session-tip",
			hermesLineageRootId: "session-root",
			workspaceId: "workspace-1",
			source: "tool-artifact",
		});
		const duplicate = linkHermesWorkspace({
			connectionId: connection.id,
			hermesSessionId: "session-tip",
			hermesLineageRootId: "session-root",
			workspaceId: "workspace-1",
			source: "manual",
		});
		linkHermesWorkspace({
			connectionId: connection.id,
			hermesSessionId: "session-tip",
			workspaceId: "workspace-2",
			source: "manual",
		});
		expect(duplicate.id).toBe(first.id);
		expect(listHermesWorkspaceLinks(connection.id, "session-tip")).toHaveLength(2);

		db.delete(schema.workspaces).where(eq(schema.workspaces.id, "workspace-1")).run();
		const missing = listHermesWorkspaceLinks(connection.id, "session-tip").find(
			(link) => link.workspaceId === "workspace-1"
		);
		expect(missing?.missing).toBe(true);

		unlinkHermesWorkspace(connection.id, "session-tip", "workspace-1");
		expect(listHermesWorkspaceLinks(connection.id, "session-tip")).toHaveLength(1);
	});
});
