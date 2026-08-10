import "./preload-electron-mock";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import YAML from "yaml";
import { startControlPlane } from "../src/main/control-plane";
import { generateToken, tokenMatchesHash } from "../src/main/control-plane/auth";
import { _setDbForTesting, getDb, schema } from "../src/main/db";
import { ensureManagedHermesMcpAccess } from "../src/main/services/external-managers";
import {
	createExternalManager,
	installIntoHermesConfig,
} from "../src/main/services/external-managers";
import { seedProject } from "./helpers/db";
import { makeTestDb } from "./test-db";

describe("managed Agents Hermes MCP access", () => {
	let directory: string;
	let configPath: string;

	beforeEach(() => {
		_setDbForTesting(makeTestDb());
		directory = mkdtempSync(join(tmpdir(), "managed-hermes-mcp-"));
		configPath = join(directory, "config.yaml");
	});

	afterEach(() => {
		_setDbForTesting(null);
		rmSync(directory, { recursive: true, force: true });
	});

	test("provisions once with all-project scope without creating project or session links", async () => {
		const firstProject = await seedProject();
		const secondProject = await seedProject();

		const first = await ensureManagedHermesMcpAccess({ configPath, userDataDir: directory });
		const second = await ensureManagedHermesMcpAccess({ configPath, userDataDir: directory });

		expect(second.managerId).toBe(first.managerId);
		expect(first.created).toBe(true);
		expect(second.created).toBe(false);
		const managers = getDb().select().from(schema.crossRepoOrchestrators).all();
		expect(managers).toHaveLength(1);
		expect(managers[0]).toMatchObject({
			id: first.managerId,
			kind: "external",
			accessScope: "all",
		});
		expect(getDb().select().from(schema.crossRepoOrchestratorProjects).all()).toHaveLength(0);
		expect(getDb().select().from(schema.hermesSessionWorkspaces).all()).toHaveLength(0);

		const parsed = YAML.parse(readFileSync(configPath, "utf8"));
		const rawToken = parsed.mcp_servers.superiorswarm.env.SUPERIORSWARM_MANAGER_TOKEN as string;
		expect(rawToken.length).toBeGreaterThan(20);
		expect(tokenMatchesHash(rawToken, managers[0]?.tokenHash ?? null)).toBe(true);
		expect(JSON.stringify(managers)).not.toContain(rawToken);

		const server = await startControlPlane({
			confirm: async () => true,
			spawnFn: async () => ({ sessionId: "s", terminalId: "t" }),
		});
		try {
			const projects = await fetch(`http://127.0.0.1:${server.port}/projects.list`, {
				headers: {
					Authorization: `Bearer ${server.token}`,
					"X-Cross-Repo-Orchestrator-Id": first.managerId,
					"X-Manager-Token": rawToken,
				},
			});
			expect(projects.status).toBe(200);
			const body = (await projects.json()) as { projects: Array<{ id: string }> };
			expect(body.projects.map((project) => project.id)).toContain(firstProject);
			expect(body.projects.map((project) => project.id)).toContain(secondProject);
		} finally {
			await server.stop();
		}
	});

	test("upgrades only the manager identified by the installed token hash", async () => {
		const projectId = await seedProject();
		const installed = await createExternalManager({
			name: "Installed Hermes",
			projectIds: [projectId],
		});
		const unrelated = await createExternalManager({
			name: "Restricted integration",
			projectIds: [projectId],
		});
		installIntoHermesConfig({
			managerToken: installed.token,
			configPath,
			userDataDir: directory,
		});

		const result = await ensureManagedHermesMcpAccess({ configPath, userDataDir: directory });

		expect(result).toMatchObject({ managerId: installed.id, created: false, upgraded: true });
		const rows = getDb().select().from(schema.crossRepoOrchestrators).all();
		expect(rows.find((row) => row.id === installed.id)?.accessScope).toBe("all");
		expect(rows.find((row) => row.id === unrelated.id)?.accessScope).toBe("selected");
		expect(rows).toHaveLength(2);
	});

	test("gives an in-product repair path when an installed token has no safe DB match", () => {
		installIntoHermesConfig({
			managerToken: generateToken(),
			configPath,
			userDataDir: directory,
		});

		expect(() => ensureManagedHermesMcpAccess({ configPath, userDataDir: directory })).toThrow(
			"Open Settings → External managers, install a manager into Hermes, then Retry."
		);
		expect(getDb().select().from(schema.crossRepoOrchestrators).all()).toHaveLength(0);
	});

	test("access-scope migration defaults existing managers to selected", () => {
		const migration = readFileSync(
			join(import.meta.dir, "../src/main/db/migrations/0057_add_external_manager_access_scope.sql"),
			"utf8"
		);
		expect(migration).toContain("ADD `access_scope` text DEFAULT 'selected' NOT NULL");
	});

	test("MCP keeps create_worktree project-ID explicit without stale bootstrap authorization", async () => {
		const server = await Bun.file(new URL("../mcp-standalone/server.mjs", import.meta.url)).text();
		const createTool = server.slice(
			server.indexOf('"create_worktree"'),
			server.indexOf('"list_workspaces"')
		);

		expect(createTool).toContain("project_id: z.string().describe");
		expect(createTool).toContain("projectId");
		expect(createTool).not.toContain("LINKED_PROJECT_IDS.includes");
		expect(server).toContain('call("GET", "/workspaces.list?accessible=true")');
	});
});
