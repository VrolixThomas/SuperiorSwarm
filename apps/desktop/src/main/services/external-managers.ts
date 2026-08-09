import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { and, asc, eq, inArray, max } from "drizzle-orm";
import { app } from "electron";
import { nanoid } from "nanoid";
import YAML from "yaml";
import { NotFoundError } from "../../shared/control-plane";
import { generateToken, hashToken } from "../control-plane/auth";
import {
	invalidateAllCrossRepoLinks,
	removeCrossRepoEventsFile,
} from "../control-plane/orchestrator-event-sink";
import { getDb } from "../db";
import {
	agentMessages,
	crossRepoOrchestratorProjects,
	crossRepoOrchestrators,
	orchestratorMembers,
} from "../db/schema";
import { addProjectToCrossRepoOrchestrator } from "./cross-repo-orchestrator-membership";
import { entryFor, installEntryToConfig, uninstallEntryFromConfig } from "./global-mcp-install";
import { launcherPath } from "./global-mcp-launcher";

// External managers are cross_repo_orchestrators rows with kind="external":
// an outside agent runtime (e.g. Hermes) that authenticates with a token
// instead of a cwd-matched coordinator terminal. The raw token is returned
// exactly once — only its SHA-256 hash is persisted.

export type DispatchPolicy = "confirm" | "auto";
export type ExternalManagerAccessScope = "selected" | "all";

export interface ExternalManagerDto {
	id: string;
	name: string;
	dispatchPolicy: DispatchPolicy;
	accessScope: ExternalManagerAccessScope;
	lastSeenAt: Date | null;
	createdAt: Date;
	linkedProjectIds: string[];
}

function workDirFor(id: string): string {
	return join(app.getPath("userData"), "external-managers", id);
}

export async function createExternalManager(input: {
	name: string;
	projectIds: string[];
	dispatchPolicy?: DispatchPolicy;
	accessScope?: ExternalManagerAccessScope;
}): Promise<{ id: string; token: string }> {
	const token = generateToken();
	const id = insertExternalManager(input, token);

	for (const projectId of input.projectIds) {
		await addProjectToCrossRepoOrchestrator({ orchestratorId: id, projectId });
	}

	return { id, token };
}

function insertExternalManager(
	input: {
		name: string;
		dispatchPolicy?: DispatchPolicy;
		accessScope?: ExternalManagerAccessScope;
	},
	token: string
): string {
	const db = getDb();
	const id = `mgr-${nanoid(8)}`;
	const now = new Date();
	const dir = workDirFor(id);
	mkdirSync(dir, { recursive: true });

	const maxRow = db
		.select({ m: max(crossRepoOrchestrators.sortOrder) })
		.from(crossRepoOrchestrators)
		.get();

	db.insert(crossRepoOrchestrators)
		.values({
			id,
			name: input.name,
			workDir: dir,
			agentKind: "external",
			status: "idle",
			sortOrder: (maxRow?.m ?? -1) + 1,
			kind: "external",
			tokenHash: hashToken(token),
			dispatchPolicy: input.dispatchPolicy ?? "confirm",
			accessScope: input.accessScope ?? "selected",
			createdAt: now,
			updatedAt: now,
		})
		.run();
	return id;
}

export async function listExternalManagers(): Promise<ExternalManagerDto[]> {
	const db = getDb();
	const rows = db
		.select({
			id: crossRepoOrchestrators.id,
			name: crossRepoOrchestrators.name,
			dispatchPolicy: crossRepoOrchestrators.dispatchPolicy,
			accessScope: crossRepoOrchestrators.accessScope,
			lastSeenAt: crossRepoOrchestrators.lastSeenAt,
			createdAt: crossRepoOrchestrators.createdAt,
		})
		.from(crossRepoOrchestrators)
		.where(eq(crossRepoOrchestrators.kind, "external"))
		.orderBy(asc(crossRepoOrchestrators.sortOrder))
		.all();

	// One grouped query instead of a linked-projects lookup per manager —
	// same pattern as listCrossRepoOrchestrators.
	const links =
		rows.length > 0
			? db
					.select({
						orchestratorId: crossRepoOrchestratorProjects.orchestratorId,
						projectId: crossRepoOrchestratorProjects.projectId,
					})
					.from(crossRepoOrchestratorProjects)
					.where(
						inArray(
							crossRepoOrchestratorProjects.orchestratorId,
							rows.map((r) => r.id)
						)
					)
					.all()
			: [];
	const byManager = new Map<string, string[]>();
	for (const l of links) {
		const arr = byManager.get(l.orchestratorId) ?? [];
		arr.push(l.projectId);
		byManager.set(l.orchestratorId, arr);
	}
	return rows.map((r) => ({ ...r, linkedProjectIds: byManager.get(r.id) ?? [] }));
}

// Guard every mutation with kind="external": manager ids share the
// cross_repo_orchestrators table with in-app coordinators, and none of this
// service's teardown (no PTY disposal, unconditional workDir rmSync) is safe
// to run against a workspace-kind row.
function externalManagerById(id: string) {
	return and(eq(crossRepoOrchestrators.id, id), eq(crossRepoOrchestrators.kind, "external"));
}

export async function setExternalManagerDispatchPolicy(input: {
	id: string;
	dispatchPolicy: DispatchPolicy;
}): Promise<{ ok: true }> {
	const res = getDb()
		.update(crossRepoOrchestrators)
		.set({ dispatchPolicy: input.dispatchPolicy, updatedAt: new Date() })
		.where(externalManagerById(input.id))
		.run();
	if (res.changes === 0) throw new NotFoundError(input.id);
	return { ok: true };
}

export async function setExternalManagerAccessScope(input: {
	id: string;
	accessScope: ExternalManagerAccessScope;
}): Promise<{ ok: true }> {
	const res = getDb()
		.update(crossRepoOrchestrators)
		.set({ accessScope: input.accessScope, updatedAt: new Date() })
		.where(externalManagerById(input.id))
		.run();
	if (res.changes === 0) throw new NotFoundError(input.id);
	invalidateAllCrossRepoLinks();
	return { ok: true };
}

export async function renameExternalManager(input: {
	id: string;
	name: string;
}): Promise<{ ok: true }> {
	const res = getDb()
		.update(crossRepoOrchestrators)
		.set({ name: input.name, updatedAt: new Date() })
		.where(externalManagerById(input.id))
		.run();
	if (res.changes === 0) throw new NotFoundError(input.id);
	return { ok: true };
}

/** Invalidate the old token and mint a new one. Returns the raw token once. */
export async function regenerateExternalManagerToken(input: {
	id: string;
}): Promise<{ token: string }> {
	const token = generateToken();
	const res = getDb()
		.update(crossRepoOrchestrators)
		.set({ tokenHash: hashToken(token), updatedAt: new Date() })
		.where(externalManagerById(input.id))
		.run();
	if (res.changes === 0) throw new NotFoundError(input.id);
	return { token };
}

export async function deleteExternalManager(input: { id: string }): Promise<{ ok: true }> {
	const db = getDb();
	const row = db
		.select({ workDir: crossRepoOrchestrators.workDir })
		.from(crossRepoOrchestrators)
		.where(externalManagerById(input.id))
		.get();
	if (!row) return { ok: true };

	db.delete(orchestratorMembers).where(eq(orchestratorMembers.orchestratorId, input.id)).run();
	// agent_messages.from_workspace_id can hold manager ids (FK dropped in 0046) —
	// replicate ON DELETE SET NULL like xro deletion does.
	db.update(agentMessages)
		.set({ fromWorkspaceId: null })
		.where(eq(agentMessages.fromWorkspaceId, input.id))
		.run();
	// cross_repo_orchestrator_projects rows cascade via FK.
	db.delete(crossRepoOrchestrators).where(eq(crossRepoOrchestrators.id, input.id)).run();

	removeCrossRepoEventsFile(input.id);
	invalidateAllCrossRepoLinks();
	try {
		rmSync(row.workDir, { recursive: true, force: true });
	} catch {}
	return { ok: true };
}

// ── Hermes config install ────────────────────────────────────────────────────

export function hermesConfigPath(home?: string): string {
	return join(home ?? homedir(), ".hermes", "config.yaml");
}

export const MANAGER_TOKEN_PLACEHOLDER = "__SUPERIORSWARM_MANAGER_TOKEN__";

function managerEnv(managerToken: string): Record<string, string> {
	return { SUPERIORSWARM_MANAGER_TOKEN: managerToken };
}

/**
 * Write the superiorswarm MCP entry (launcher + manager token env) into
 * ~/.hermes/config.yaml, via the same entry builder as every other CLI install.
 * The raw token necessarily lands in the client config — the standard MCP
 * env-secret pattern; our DB keeps only the hash.
 */
export function installIntoHermesConfig(input: {
	managerToken: string;
	configPath?: string;
	userDataDir?: string;
}): { configPath: string } {
	const configPath = input.configPath ?? hermesConfigPath();
	const launcher = launcherPath(input.userDataDir ?? app.getPath("userData"));
	installEntryToConfig(configPath, "yaml", launcher, managerEnv(input.managerToken));
	return { configPath };
}

export interface ManagedHermesMcpAccessResult {
	managerId: string;
	created: boolean;
	upgraded: boolean;
}

const MANAGED_HERMES_MANAGER_NAME = "Agents (managed Hermes)";
const MANAGED_HERMES_UPGRADE_MESSAGE =
	"Agents could not safely reuse the existing Hermes MCP identity. Open Settings → External managers, install a manager into Hermes, then Retry.";

function installedHermesManagerToken(configPath: string): string | null {
	if (!existsSync(configPath)) return null;
	let parsed: unknown;
	try {
		parsed = YAML.parse(readFileSync(configPath, "utf-8"));
	} catch {
		throw new Error(MANAGED_HERMES_UPGRADE_MESSAGE);
	}
	if (!parsed || typeof parsed !== "object") return null;
	const servers = (parsed as Record<string, unknown>)["mcp_servers"];
	if (!servers || typeof servers !== "object") return null;
	const entry = (servers as Record<string, unknown>)["superiorswarm"];
	if (!entry || typeof entry !== "object") return null;
	const env = (entry as Record<string, unknown>)["env"];
	if (!env || typeof env !== "object") return null;
	const token = (env as Record<string, unknown>)["SUPERIORSWARM_MANAGER_TOKEN"];
	return typeof token === "string" && token.length > 0 ? token : null;
}

/**
 * Ensure the app-owned Hermes backend has a live-inventory manager identity.
 * The raw credential is read from or written to Hermes' standard MCP config;
 * this service returns only the manager id and persists only its secure hash.
 */
export function ensureManagedHermesMcpAccess(
	input: {
		configPath?: string;
		userDataDir?: string;
	} = {}
): ManagedHermesMcpAccessResult {
	const configPath = input.configPath ?? hermesConfigPath();
	const installedToken = installedHermesManagerToken(configPath);
	if (installedToken) {
		const matches = getDb()
			.select({
				id: crossRepoOrchestrators.id,
				accessScope: crossRepoOrchestrators.accessScope,
			})
			.from(crossRepoOrchestrators)
			.where(
				and(
					eq(crossRepoOrchestrators.kind, "external"),
					eq(crossRepoOrchestrators.tokenHash, hashToken(installedToken))
				)
			)
			.all();
		const match = matches[0];
		if (matches.length !== 1 || !match) throw new Error(MANAGED_HERMES_UPGRADE_MESSAGE);
		installIntoHermesConfig({
			managerToken: installedToken,
			configPath,
			userDataDir: input.userDataDir,
		});
		if (match.accessScope !== "all") {
			getDb()
				.update(crossRepoOrchestrators)
				.set({ accessScope: "all", updatedAt: new Date() })
				.where(externalManagerById(match.id))
				.run();
			invalidateAllCrossRepoLinks();
		}
		return {
			managerId: match.id,
			created: false,
			upgraded: match.accessScope !== "all",
		};
	}

	const token = generateToken();
	const managerId = insertExternalManager(
		{
			name: MANAGED_HERMES_MANAGER_NAME,
			dispatchPolicy: "confirm",
			accessScope: "all",
		},
		token
	);
	try {
		installIntoHermesConfig({
			managerToken: token,
			configPath,
			userDataDir: input.userDataDir,
		});
	} catch (error) {
		void deleteExternalManager({ id: managerId });
		throw error;
	}
	invalidateAllCrossRepoLinks();
	return { managerId, created: true, upgraded: false };
}

export function uninstallFromHermesConfig(input: { configPath?: string }): { ok: true } {
	uninstallEntryFromConfig(input.configPath ?? hermesConfigPath(), "yaml");
	return { ok: true };
}

/**
 * The manual-setup snippet for the settings UI, derived from the same entry
 * builder installIntoHermesConfig writes — so the copy-paste path can never
 * drift from the install path. The renderer substitutes the one-time raw
 * token for MANAGER_TOKEN_PLACEHOLDER.
 */
export function hermesSnippetTemplate(userDataDir?: string): string {
	const launcher = launcherPath(userDataDir ?? app.getPath("userData"));
	const entry = entryFor("yaml", launcher, managerEnv(MANAGER_TOKEN_PLACEHOLDER));
	return YAML.stringify({ mcp_servers: { superiorswarm: entry } }).trimEnd();
}
