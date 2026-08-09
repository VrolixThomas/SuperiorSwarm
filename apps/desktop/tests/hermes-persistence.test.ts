import "./preload-electron-mock";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { _setDbForTesting, schema } from "../src/main/db";
import {
	HERMES_LOCAL_MANAGED_URL,
	deleteHermesConnection,
	ensureHermesLocalConnection,
	getHermesConnectionWithToken,
	listHermesConnections,
	saveHermesConnection,
} from "../src/main/hermes/hermes-connections";
import { getHermesOriginLink, saveHermesOriginLink } from "../src/main/hermes/hermes-origin-links";
import {
	beginHermesOriginReportAttempt,
	finishHermesOriginReport,
	prepareHermesOriginReport,
} from "../src/main/hermes/hermes-origin-reports";
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

	test("persists a stable managed-local identity without an ephemeral endpoint or token", () => {
		const first = ensureHermesLocalConnection({ profileId: "work" }, vault);
		const second = ensureHermesLocalConnection({}, vault);
		const stored = db
			.select()
			.from(schema.hermesConnections)
			.where(eq(schema.hermesConnections.id, first.id))
			.get();

		expect(second.id).toBe(first.id);
		expect(first).toMatchObject({
			managementMode: "managed",
			connectionMode: "loopback",
			baseUrl: null,
			hasToken: false,
			profileId: "work",
		});
		expect(stored).toMatchObject({
			baseUrl: HERMES_LOCAL_MANAGED_URL,
			managementMode: "managed",
			encryptedToken: null,
			tokenStorage: "memory",
		});
		expect(JSON.stringify(first)).not.toContain("8080");
	});

	test("maps legacy managed custom to stock default without changing external custom", () => {
		const external = saveHermesConnection(
			{
				label: "External custom profile",
				baseUrl: "https://hermes.example.com",
				profileId: "custom",
				token: "external-token",
			},
			vault
		);
		const managed = ensureHermesLocalConnection({ profileId: "custom" }, vault);

		expect(external).toMatchObject({
			managementMode: "external",
			profileId: "custom",
		});
		expect(managed).toMatchObject({
			managementMode: "managed",
			profileId: "default",
		});
	});

	test("keeps migrated legacy transport fields recoverable during startup ensure", () => {
		const now = new Date(1);
		db.insert(schema.hermesConnections)
			.values({
				id: "migrated-local",
				label: "Local Hermes",
				baseUrl: "http://127.0.0.1:8080",
				profileId: "default",
				managementMode: "managed",
				encryptedToken: "recoverable-ciphertext",
				tokenStorage: "safe-storage",
				createdAt: now,
				updatedAt: now,
			})
			.run();

		ensureHermesLocalConnection({}, vault);

		const stored = db
			.select()
			.from(schema.hermesConnections)
			.where(eq(schema.hermesConnections.id, "migrated-local"))
			.get();
		expect(stored).toMatchObject({
			baseUrl: "http://127.0.0.1:8080",
			encryptedToken: "recoverable-ciphertext",
			tokenStorage: "safe-storage",
			managementMode: "managed",
		});
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

	test("allows secure remote stock browsing but distinguishes it from loopback delivery", () => {
		const remote = saveHermesConnection(
			{
				label: "Remote",
				baseUrl: "https://hermes.example.com",
				profileId: "default",
				token: "token",
			},
			vault
		);
		expect(remote.connectionMode).toBe("remote");
		expect(remote.authMode).toBe("token");
		expect(() =>
			saveHermesConnection(
				{
					label: "Insecure remote",
					baseUrl: "http://hermes.example.com",
					profileId: "default",
					token: "token",
				},
				vault
			)
		).toThrow("HTTPS");

		const connection = saveHermesConnection(
			{
				label: "Local",
				baseUrl: "ws://localhost:8080/api/ws",
				profileId: "default",
				token: "token",
			},
			vault
		);
		expect(connection.connectionMode).toBe("loopback");
		deleteHermesConnection(connection.id, vault);
		deleteHermesConnection(remote.id, vault);
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
			db.insert(schema.worktrees)
				.values({
					id: `worktree-${workspaceId}`,
					projectId: "project-1",
					path: `/repos/app-worktrees/${workspaceId}`,
					branch: `feat/${workspaceId}`,
					baseBranch: "main",
					createdAt: now,
					updatedAt: now,
				})
				.run();
			db.insert(schema.workspaces)
				.values({
					id: workspaceId,
					projectId: "project-1",
					type: "worktree",
					name: workspaceId,
					worktreeId: `worktree-${workspaceId}`,
					terminalId: workspaceId === "workspace-1" ? "persisted-terminal-1" : null,
					currentPhase: workspaceId === "workspace-1" ? "blocked" : "working",
					statusText: workspaceId === "workspace-1" ? "Waiting for CI" : "Implementing",
					needs: workspaceId === "workspace-1" ? "CI credentials" : null,
					statusUpdatedAt: now,
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
		const linked = listHermesWorkspaceLinks(connection.id, "session-tip");
		expect(linked).toHaveLength(2);
		expect(linked.find((link) => link.workspaceId === "workspace-1")).toMatchObject({
			hasTerminal: true,
			currentPhase: "blocked",
			statusText: "Waiting for CI",
			needs: "CI credentials",
			statusUpdatedAt: Math.floor(now.getTime() / 1_000) * 1_000,
		});

		db.delete(schema.workspaces).where(eq(schema.workspaces.id, "workspace-1")).run();
		const missing = listHermesWorkspaceLinks(connection.id, "session-tip").find(
			(link) => link.workspaceId === "workspace-1"
		);
		expect(missing?.missing).toBe(true);
		expect(missing).toMatchObject({
			hasTerminal: false,
			currentPhase: null,
			statusText: null,
			needs: null,
			statusUpdatedAt: null,
		});

		unlinkHermesWorkspace(connection.id, "session-tip", "workspace-1");
		expect(listHermesWorkspaceLinks(connection.id, "session-tip")).toHaveLength(1);
	});

	test("atomically suppresses duplicate report clicks and requires explicit retry after failure", () => {
		const connection = saveHermesConnection(
			{
				label: "Local",
				baseUrl: "http://localhost:8080",
				profileId: "work",
				token: "token",
			},
			vault
		);
		const identity = {
			connectionId: connection.id,
			profileId: "work",
			hermesSessionId: "stored-1",
			messageId: "assistant-message-1",
			content: "Confirmed update",
			destinationFingerprint: "opaque-destination-fingerprint",
		};

		expect(prepareHermesOriginReport(identity).status).toBe("pending");
		const first = beginHermesOriginReportAttempt({ ...identity, explicitRetry: false });
		expect(first.shouldSend).toBe(true);
		expect(first.state).toMatchObject({ status: "sending", attemptCount: 1 });

		const duplicate = beginHermesOriginReportAttempt({ ...identity, explicitRetry: false });
		expect(duplicate.shouldSend).toBe(false);
		expect(duplicate.state.status).toBe("duplicate-suppressed");

		expect(
			finishHermesOriginReport({
				...identity,
				status: "failed",
				retryable: true,
				errorCode: "timeout",
			}).status
		).toBe("failed");
		expect(beginHermesOriginReportAttempt({ ...identity, explicitRetry: false }).shouldSend).toBe(
			false
		);

		const retry = beginHermesOriginReportAttempt({ ...identity, explicitRetry: true });
		expect(retry.state).toMatchObject({ status: "sending", attemptCount: 2 });
		expect(
			finishHermesOriginReport({
				...identity,
				status: "sent",
				retryable: false,
				providerMessageId: "provider-1",
			}).status
		).toBe("sent");
		expect(beginHermesOriginReportAttempt({ ...identity, explicitRetry: true }).state.status).toBe(
			"duplicate-suppressed"
		);

		const serialized = JSON.stringify(db.select().from(schema.hermesOriginReports).all());
		expect(serialized).not.toContain("slack:C");
	});

	test("allows an explicit retry of a sending receipt orphaned by process restart", () => {
		const connection = saveHermesConnection(
			{
				label: "Local",
				baseUrl: "http://localhost:8080",
				profileId: "work",
				token: "token",
			},
			vault
		);
		const identity = {
			connectionId: connection.id,
			profileId: "work",
			hermesSessionId: "stored-after-crash",
			messageId: "assistant-message-after-crash",
			content: "Resume this delivery",
			destinationFingerprint: "opaque-restart-destination",
		};
		prepareHermesOriginReport(identity);
		const prepared = db.select().from(schema.hermesOriginReports).get();
		expect(prepared).toBeDefined();
		db.update(schema.hermesOriginReports)
			.set({ status: "sending", retryable: false, attemptCount: 1 })
			.where(eq(schema.hermesOriginReports.id, prepared?.id ?? "missing"))
			.run();

		const passive = beginHermesOriginReportAttempt({ ...identity, explicitRetry: false });
		expect(passive).toMatchObject({
			shouldSend: false,
			state: { status: "sending", retryable: true },
		});

		const retry = beginHermesOriginReportAttempt({ ...identity, explicitRetry: true });
		expect(retry).toMatchObject({
			shouldSend: true,
			state: { status: "sending", retryable: false, attemptCount: 2 },
		});
	});

	test("stores only a validated Slack URL and invalidates it when origin identity changes", () => {
		const connection = saveHermesConnection(
			{
				label: "Local",
				baseUrl: "http://localhost:8080",
				profileId: "work",
				token: "token",
			},
			vault
		);
		const identity = {
			connectionId: connection.id,
			profileId: "work",
			hermesSessionId: "stored-1",
			originFingerprint: "fingerprint-1",
		};

		expect(
			saveHermesOriginLink({
				...identity,
				openUrl: "https://workspace.slack.com/archives/C12345/p1234567890000000",
			})
		).toBe("https://workspace.slack.com/archives/C12345/p1234567890000000");
		expect(getHermesOriginLink(identity)).toContain("workspace.slack.com");
		expect(getHermesOriginLink({ ...identity, originFingerprint: "fingerprint-2" })).toBeNull();
		expect(db.select().from(schema.hermesOriginLinks).all()).toEqual([]);
		expect(() =>
			saveHermesOriginLink({ ...identity, openUrl: "https://example.com/thread" })
		).toThrow("Slack");
	});
});
