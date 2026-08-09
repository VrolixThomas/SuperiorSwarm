import { randomUUID } from "node:crypto";
import { closeSync, openSync, readSync, realpathSync, statSync } from "node:fs";
import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";
import { and, desc, eq, inArray, isNotNull, ne } from "drizzle-orm";
import {
	ForbiddenError,
	NotFoundError,
	ResumeNotSupportedError,
	agentOutputRequestSchema,
	createWorkspaceRequestSchema,
	dispatchAgentRequestSchema,
	eventsPollRequestSchema,
	getWorkspaceRequestSchema,
	hermesSessionAdmissionRequestSchema,
	listWorkspacesRequestSchema,
	readMessagesRequestSchema,
	removeWorkspaceRequestSchema,
	resumeAgentRequestSchema,
	sendMessageRequestSchema,
	setStatusRequestSchema,
} from "../../shared/control-plane";
import { getDb } from "../db";
import {
	crossRepoOrchestratorProjects,
	crossRepoOrchestrators,
	projects,
	terminalSessions,
	workspaces,
	worktrees,
} from "../db/schema";
import { admitHermesSession } from "../hermes/hermes-session-admissions";
import { getOrchestratorAutoDispatch } from "../services/orchestrator-dispatch-policy";
import {
	type CallerContext,
	type SpawnFn,
	createWorkspace,
	dispatchAgent,
	getWorkspace,
	listWorkspaces,
	listWorkspacesForProjects,
	readMessages,
	removeWorkspace,
	resumeAgent,
	sendMessage,
	setStatus,
} from "../services/workspace-service";
import { hashToken, isValidBearer, tokenMatchesHash } from "./auth";
import type { EventBus } from "./event-bus";
import { crossRepoEventsFilePath, eventsFilePathForProject } from "./orchestrator-event-sink";
import type { TaskRegistry } from "./task-registry";

type CrossRepoAccessScope = "selected" | "all";

function crossRepoProjectIds(orchestratorId: string, accessScope: CrossRepoAccessScope): string[] {
	if (accessScope === "all") {
		return getDb()
			.select({ projectId: projects.id })
			.from(projects)
			.all()
			.map((row) => row.projectId);
	}
	return getDb()
		.select({ projectId: crossRepoOrchestratorProjects.projectId })
		.from(crossRepoOrchestratorProjects)
		.where(eq(crossRepoOrchestratorProjects.orchestratorId, orchestratorId))
		.all()
		.map((row) => row.projectId);
}

function resolveProjectIdFromWorkspace(workspaceId: string): string | null {
	return (
		getDb()
			.select({ projectId: workspaces.projectId })
			.from(workspaces)
			.where(eq(workspaces.id, workspaceId))
			.get()?.projectId ?? null
	);
}

/**
 * Derive the effective projectId for a workspace-targeting route and verify the
 * caller is allowed to touch it. Returns the projectId together with the
 * resolved caller so handlers make policy decisions (e.g. dispatch
 * auto-approve) from the same identity that passed authorization, instead of
 * resolving it a second time. Returns null after writing the error response.
 */
function resolveScopedProjectId(
	req: IncomingMessage,
	res: ServerResponse,
	requestId: string,
	explicitProjectId: string | undefined,
	workspaceId: string
): { projectId: string; caller: CallerContext } | null {
	let projectId = explicitProjectId;
	if (!projectId) {
		const derived = resolveProjectIdFromWorkspace(workspaceId);
		if (!derived) {
			respond(res, 404, requestId, { error: "not_found" });
			return null;
		}
		projectId = derived;
	}
	// Same enforcement as set_status/send_message: xro callers must have the
	// project linked; workspace callers must belong to the project.
	const caller = resolveCaller(req, projectId);
	if ("error" in caller) {
		respond(res, 401, requestId, { error: "unauthorized" });
		return null;
	}
	return { projectId, caller };
}

async function attachIfCallerIsOrchestrator(
	req: IncomingMessage,
	projectId: string,
	targetWorkspaceId: string,
	createdByDispatch = false
): Promise<void> {
	const caller = resolveCaller(req, projectId);
	if ("error" in caller) return;

	if (caller.kind === "xro") {
		// Cross-repo orchestrator dispatching/creating a child: insert an orchestrator_members row.
		try {
			const { attachToCrossRepoOrchestrator } = await import(
				"../services/cross-repo-orchestrator-membership"
			);
			await attachToCrossRepoOrchestrator({
				orchestratorId: caller.xroId,
				workspaceId: targetWorkspaceId,
				createdByDispatch,
			});
		} catch (err) {
			console.warn(`[control-plane] xro auto-attach failed: ${(err as Error).message}`);
		}
		return;
	}

	// Only workspace-agent orchestrators participate in orchestrator_members.
	// Cross-repo orchestrators manage membership through cross_repo_orchestrator_projects.
	if (caller.kind !== "workspace") return;
	if (caller.workspaceId === targetWorkspaceId) return;
	const orch = getDb()
		.select({ isOrchestrator: workspaces.isOrchestrator })
		.from(workspaces)
		.where(eq(workspaces.id, caller.workspaceId))
		.get();
	if (!orch?.isOrchestrator) return;
	try {
		const { attachToOrchestrator } = await import("../services/orchestrator-membership");
		await attachToOrchestrator({
			orchestratorId: caller.workspaceId,
			workspaceId: targetWorkspaceId,
		});
	} catch (err) {
		console.warn(`[control-plane] auto-attach failed: ${(err as Error).message}`);
	}
}

export type ConfirmFn = (req: {
	kind: "dispatch" | "remove";
	workspaceName: string;
	branch: string | null;
	summary: string;
}) => Promise<boolean>;

export interface ControlPlaneDeps {
	token: string;
	confirm: ConfirmFn;
	spawnFn: SpawnFn;
	eventBus: EventBus;
	taskRegistry: TaskRegistry;
}

function resolveCaller(
	req: IncomingMessage,
	projectIdHint: string | null
): CallerContext | { error: string } {
	const wsId = req.headers["x-workspace-id"];
	const xroId = req.headers["x-cross-repo-orchestrator-id"];

	if (typeof xroId === "string" && xroId.length > 0) {
		// Cross-repo orchestrator mode: look up in cross_repo_orchestrators.
		const row = getDb()
			.select({
				id: crossRepoOrchestrators.id,
				kind: crossRepoOrchestrators.kind,
				tokenHash: crossRepoOrchestrators.tokenHash,
				dispatchPolicy: crossRepoOrchestrators.dispatchPolicy,
				accessScope: crossRepoOrchestrators.accessScope,
			})
			.from(crossRepoOrchestrators)
			.where(eq(crossRepoOrchestrators.id, xroId))
			.get();
		if (!row) return { error: "unknown cross-repo orchestrator" };
		if (row.kind === "external") {
			// External managers must prove identity on every request — the xro id
			// alone is guessable by anything holding the control token.
			const managerToken = req.headers["x-manager-token"];
			if (typeof managerToken !== "string" || !tokenMatchesHash(managerToken, row.tokenHash)) {
				return { error: "invalid manager token" };
			}
		}
		const linkedProjectIds = crossRepoProjectIds(xroId, row.accessScope);
		if (projectIdHint && !linkedProjectIds.includes(projectIdHint)) {
			return { error: "project not linked to this cross-repo orchestrator" };
		}
		return {
			kind: "xro",
			xroId,
			linkedProjectIds,
			external: row.kind === "external",
			dispatchPolicy: row.dispatchPolicy,
			accessScope: row.accessScope,
		};
	}

	if (typeof wsId !== "string" || wsId.length === 0) {
		return { error: "missing X-Workspace-Id header" };
	}
	const row = getDb()
		.select({ projectId: workspaces.projectId })
		.from(workspaces)
		.where(eq(workspaces.id, wsId))
		.get();
	if (!row) return { error: "unknown workspace" };
	if (projectIdHint && row.projectId !== projectIdHint) {
		return { error: "workspace/project mismatch" };
	}
	return { kind: "workspace", workspaceId: wsId, projectId: row.projectId };
}

function isOrchestratorWorkspace(workspaceId: string): boolean {
	const row = getDb()
		.select({ isOrchestrator: workspaces.isOrchestrator })
		.from(workspaces)
		.where(eq(workspaces.id, workspaceId))
		.get();
	return row?.isOrchestrator === true;
}

/**
 * Resolve the events jsonl the caller may poll: xros (incl. external managers)
 * get their aggregated file; workspace callers must be the project orchestrator.
 */
function eventsFileForCaller(caller: CallerContext): string | null {
	if (caller.kind === "xro") return crossRepoEventsFilePath(caller.xroId);
	if (!isOrchestratorWorkspace(caller.workspaceId)) return null;
	return eventsFilePathForProject(caller.projectId);
}

/**
 * Incremental reader for an append-only \n-terminated jsonl file. refresh()
 * reads only bytes appended since the last call, so a long-poll loop does not
 * re-read the whole file every tick. A shrink (orchestrator reset) discards
 * state and re-reads from the start. Splitting on \n at the byte level is safe
 * for UTF-8: 0x0a never occurs inside a multibyte sequence.
 */
class EventFileTail {
	private offset = 0;
	private partial = Buffer.alloc(0);
	private lines: string[] = [];

	constructor(private readonly path: string) {}

	refresh(): string[] {
		let size = 0;
		try {
			size = statSync(this.path).size;
		} catch {
			size = 0;
		}
		if (size < this.offset) {
			this.offset = 0;
			this.partial = Buffer.alloc(0);
			this.lines = [];
		}
		if (size === this.offset) return this.lines;
		let appended: Buffer;
		try {
			const fd = openSync(this.path, "r");
			try {
				appended = Buffer.alloc(size - this.offset);
				let read = 0;
				while (read < appended.length) {
					const n = readSync(fd, appended, read, appended.length - read, this.offset + read);
					if (n === 0) break;
					read += n;
				}
				appended = appended.subarray(0, read);
			} finally {
				closeSync(fd);
			}
		} catch {
			return this.lines;
		}
		this.offset += appended.length;
		const chunk = Buffer.concat([this.partial, appended]);
		let start = 0;
		for (let i = 0; i < chunk.length; i++) {
			if (chunk[i] === 0x0a) {
				if (i > start) this.lines.push(chunk.subarray(start, i).toString("utf-8"));
				start = i + 1;
			}
		}
		this.partial = Buffer.from(chunk.subarray(start));
		return this.lines;
	}
}

function stripAnsi(s: string): string {
	return (
		s
			// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping terminal output requires matching ESC/BEL
			.replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, "") // OSC sequences
			// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping terminal output requires matching ESC/BEL
			.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "") // CSI sequences
			// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping terminal output requires matching ESC/BEL
			.replace(/\u001b[@-Z\\^_]/g, "") // remaining C1 escapes
	);
}

export function createControlPlaneServer(deps: ControlPlaneDeps): Server {
	return createServer((req, res) => {
		const requestId = randomUUID();
		const start = Date.now();
		res.on("finish", () => {
			const ms = Date.now() - start;
			console.log(
				`[control-plane] ${req.method ?? "GET"} ${req.url ?? "/"} ${res.statusCode} request_id=${requestId} latency=${ms}ms`
			);
		});
		void handleRequest(req, res, deps, requestId).catch((err) => {
			console.error(`[control-plane] unhandled error request_id=${requestId}:`, err);
			respond(res, 500, requestId, { error: "internal" });
		});
	});
}

export function isLoopback(addr: string | undefined): boolean {
	if (!addr) return false; // unknown remote address — fail closed
	return (
		addr === "127.0.0.1" ||
		addr === "::1" ||
		addr === "::ffff:127.0.0.1" ||
		addr.startsWith("::ffff:127.")
	);
}

async function handleRequest(
	req: IncomingMessage,
	res: ServerResponse,
	deps: ControlPlaneDeps,
	requestId: string
): Promise<void> {
	if (!isLoopback(req.socket.remoteAddress)) {
		respond(res, 401, requestId, { error: "unauthorized" });
		return;
	}
	if (!isValidBearer(req.headers.authorization, deps.token)) {
		console.warn(`[control-plane] unauthorized request request_id=${requestId}`);
		respond(res, 401, requestId, { error: "unauthorized" });
		return;
	}

	const url = new URL(req.url ?? "/", "http://127.0.0.1");
	const route = `${req.method ?? "GET"} ${url.pathname}`;

	try {
		switch (route) {
			case "GET /context.resolve": {
				const cwd = url.searchParams.get("cwd") ?? "";
				// Task tokens outrank manager tokens: a review/solve/quick-action
				// launch that inherits SUPERIORSWARM_MANAGER_TOKEN from its
				// environment must still resolve as its task, not as the manager.
				const taskToken = url.searchParams.get("taskToken");
				if (taskToken) {
					const reg = deps.taskRegistry.consume(taskToken);
					if (reg) {
						respond(res, 200, requestId, reg);
						return;
					}
				}
				// External manager bootstrap: identity comes from the token, not cwd.
				// Header only, never a query param — req.url is logged on every
				// response and must not contain the raw secret.
				const managerToken = req.headers["x-manager-token"];
				if (typeof managerToken === "string" && managerToken.length > 0) {
					const manager = getDb()
						.select({
							id: crossRepoOrchestrators.id,
							accessScope: crossRepoOrchestrators.accessScope,
						})
						.from(crossRepoOrchestrators)
						.where(
							and(
								eq(crossRepoOrchestrators.kind, "external"),
								eq(crossRepoOrchestrators.tokenHash, hashToken(managerToken))
							)
						)
						.get();
					if (!manager) {
						respond(res, 401, requestId, { error: "unauthorized" });
						return;
					}
					getDb()
						.update(crossRepoOrchestrators)
						.set({ lastSeenAt: new Date() })
						.where(eq(crossRepoOrchestrators.id, manager.id))
						.run();
					const linkedProjectIds = crossRepoProjectIds(manager.id, manager.accessScope);
					respond(res, 200, requestId, {
						mode: "external-manager",
						crossRepoOrchestratorId: manager.id,
						linkedProjectIds,
						accessScope: manager.accessScope,
						isOrchestrator: true,
						modeContext: {},
					});
					return;
				}
				let realCwd = cwd;
				try {
					realCwd = cwd ? realpathSync(cwd) : "";
				} catch {}
				const row = realCwd
					? getDb()
							.select({
								projectId: worktrees.projectId,
								workspaceId: workspaces.id,
								isOrchestrator: workspaces.isOrchestrator,
								path: worktrees.path,
							})
							.from(worktrees)
							.leftJoin(workspaces, eq(workspaces.worktreeId, worktrees.id))
							.all()
							.find((r) => {
								try {
									return realpathSync(r.path) === realCwd;
								} catch {
									return r.path === realCwd;
								}
							})
					: undefined;
				if (row?.workspaceId) {
					const isOrch = row.isOrchestrator ?? false;
					respond(res, 200, requestId, {
						mode: "workspace-agent",
						projectId: row.projectId,
						workspaceId: row.workspaceId,
						isOrchestrator: isOrch,
						orchestratorEventsPath: isOrch ? eventsFilePathForProject(row.projectId) : undefined,
						modeContext: {},
					});
					return;
				}
				if (realCwd) {
					// External-manager rows never resolve by cwd — without a manager
					// token the session could not authenticate any follow-up call, so
					// matching one here would only produce a broken half-session.
					const xro = getDb()
						.select({
							id: crossRepoOrchestrators.id,
							workDir: crossRepoOrchestrators.workDir,
							accessScope: crossRepoOrchestrators.accessScope,
						})
						.from(crossRepoOrchestrators)
						.where(ne(crossRepoOrchestrators.kind, "external"))
						.all()
						.find((r) => {
							try {
								return realpathSync(r.workDir) === realCwd;
							} catch {
								return r.workDir === realCwd;
							}
						});
					if (xro) {
						const linkedProjectIds = crossRepoProjectIds(xro.id, xro.accessScope);
						respond(res, 200, requestId, {
							mode: "cross-repo-orchestrator",
							crossRepoOrchestratorId: xro.id,
							linkedProjectIds,
							accessScope: xro.accessScope,
							orchestratorEventsPath: crossRepoEventsFilePath(xro.id),
							isOrchestrator: true,
							modeContext: {},
						});
						return;
					}
				}
				respond(res, 200, requestId, { mode: "none" });
				return;
			}
			case "POST /hermes.sessions.admit": {
				const body = await readJson(req, 4_096);
				const parsed = hermesSessionAdmissionRequestSchema.safeParse(body);
				if (!parsed.success) {
					respond(res, 400, requestId, { error: "validation", details: parsed.error.flatten() });
					return;
				}
				const caller = resolveCaller(req, null);
				if ("error" in caller) {
					respond(res, 401, requestId, { error: "unauthorized" });
					return;
				}
				if (caller.kind !== "xro" || caller.external !== true) {
					respond(res, 403, requestId, { error: "forbidden" });
					return;
				}
				respond(
					res,
					200,
					requestId,
					admitHermesSession({
						managerId: caller.xroId,
						metadata: parsed.data.metadata,
						reason: parsed.data.reason,
					})
				);
				return;
			}
			case "GET /workspaces.list": {
				if (url.searchParams.get("accessible") === "true") {
					const caller = resolveCaller(req, null);
					if ("error" in caller) {
						respond(res, 401, requestId, { error: "unauthorized" });
						return;
					}
					const ids = caller.kind === "xro" ? caller.linkedProjectIds : [caller.projectId];
					const accessible = await listWorkspacesForProjects({ projectIds: ids });
					respond(res, 200, requestId, { workspaces: accessible.workspaces });
					return;
				}
				const projectIdsRaw = url.searchParams.get("projectIds");
				if (projectIdsRaw) {
					const ids = projectIdsRaw.split(",").filter(Boolean);
					const caller = resolveCaller(req, null);
					if ("error" in caller) {
						respond(res, 401, requestId, { error: "unauthorized" });
						return;
					}
					if (caller.kind === "xro") {
						if (!ids.every((id) => caller.linkedProjectIds.includes(id))) {
							respond(res, 401, requestId, { error: "unauthorized" });
							return;
						}
					} else {
						// workspace caller: every requested id must equal caller.projectId
						if (!ids.every((id) => id === caller.projectId)) {
							respond(res, 401, requestId, { error: "unauthorized" });
							return;
						}
					}
					respond(res, 200, requestId, await listWorkspacesForProjects({ projectIds: ids }));
					return;
				}
				const parsed = listWorkspacesRequestSchema.safeParse({
					projectId: url.searchParams.get("projectId"),
				});
				if (!parsed.success) {
					respond(res, 400, requestId, { error: "validation", details: parsed.error.flatten() });
					return;
				}
				const listCaller = resolveCaller(req, parsed.data.projectId);
				if ("error" in listCaller) {
					respond(res, 401, requestId, { error: "unauthorized" });
					return;
				}
				respond(res, 200, requestId, await listWorkspaces(parsed.data));
				return;
			}
			case "GET /workspaces.get": {
				const rawProjectId = url.searchParams.get("projectId");
				const parsed = getWorkspaceRequestSchema.safeParse({
					projectId: rawProjectId && rawProjectId.length > 0 ? rawProjectId : undefined,
					workspaceId: url.searchParams.get("workspaceId"),
				});
				if (!parsed.success) {
					respond(res, 400, requestId, { error: "validation", details: parsed.error.flatten() });
					return;
				}
				const getScope = resolveScopedProjectId(
					req,
					res,
					requestId,
					parsed.data.projectId,
					parsed.data.workspaceId
				);
				if (!getScope) return;
				respond(
					res,
					200,
					requestId,
					await getWorkspace({ ...parsed.data, projectId: getScope.projectId })
				);
				return;
			}
			case "POST /workspaces.create": {
				const body = await readJson(req);
				const parsed = createWorkspaceRequestSchema.safeParse(body);
				if (!parsed.success) {
					respond(res, 400, requestId, { error: "validation", details: parsed.error.flatten() });
					return;
				}
				const caller = resolveCaller(req, parsed.data.projectId);
				if ("error" in caller) {
					respond(res, 401, requestId, { error: "unauthorized" });
					return;
				}
				const created = await createWorkspace(parsed.data);
				await attachIfCallerIsOrchestrator(req, parsed.data.projectId, created.workspaceId, true);
				respond(res, 200, requestId, created);
				return;
			}
			case "POST /workspaces.dispatch": {
				const body = await readJson(req);
				const parsed = dispatchAgentRequestSchema.safeParse(body);
				if (!parsed.success) {
					respond(res, 400, requestId, { error: "validation", details: parsed.error.flatten() });
					return;
				}
				const dispatchScope = resolveScopedProjectId(
					req,
					res,
					requestId,
					parsed.data.projectId,
					parsed.data.workspaceId
				);
				if (!dispatchScope) return;
				const { projectId: dispatchProjectId, caller: dispatchCaller } = dispatchScope;
				const ws = await getWorkspace({
					projectId: dispatchProjectId,
					workspaceId: parsed.data.workspaceId,
				});
				// Auto-approval, two independent opt-ins (remove_worktree is never
				// auto-approved):
				//  - external managers whose per-manager dispatch_policy is "auto"
				//  - in-app orchestrators (per-repo orchestrator workspaces and
				//    cross-repo coordinators) when the global orchestratorAutoDispatch
				//    setting is on. The global setting deliberately does NOT extend to
				//    external managers — their policy stays per-manager.
				let autoApproved = false;
				if (dispatchCaller.kind === "xro" && dispatchCaller.external === true) {
					autoApproved = dispatchCaller.dispatchPolicy === "auto";
				} else if (getOrchestratorAutoDispatch()) {
					autoApproved =
						dispatchCaller.kind === "xro" || isOrchestratorWorkspace(dispatchCaller.workspaceId);
				}
				const allowed =
					autoApproved ||
					(await deps.confirm({
						kind: "dispatch",
						workspaceName: ws.name,
						branch: ws.branch,
						summary: `Run "${parsed.data.cliPreset ?? "claude"}" with prompt: ${parsed.data.prompt.slice(0, 200)}`,
					}));
				if (!allowed) {
					respond(res, 499, requestId, { error: "cancelled_by_user" });
					return;
				}
				const result = await dispatchAgent(
					{ ...parsed.data, projectId: dispatchProjectId },
					{ spawnFn: deps.spawnFn }
				);
				await attachIfCallerIsOrchestrator(req, dispatchProjectId, parsed.data.workspaceId);
				respond(res, 200, requestId, result);
				return;
			}
			case "POST /workspaces.remove": {
				const body = await readJson(req);
				const parsed = removeWorkspaceRequestSchema.safeParse(body);
				if (!parsed.success) {
					respond(res, 400, requestId, { error: "validation", details: parsed.error.flatten() });
					return;
				}
				const removeScope = resolveScopedProjectId(
					req,
					res,
					requestId,
					parsed.data.projectId,
					parsed.data.workspaceId
				);
				if (!removeScope) return;
				const removeProjectId = removeScope.projectId;
				const ws = await getWorkspace({
					projectId: removeProjectId,
					workspaceId: parsed.data.workspaceId,
				});
				const allowed = await deps.confirm({
					kind: "remove",
					workspaceName: ws.name,
					branch: ws.branch,
					summary: `Remove worktree for "${ws.name}"${parsed.data.force ? " (force)" : ""}`,
				});
				if (!allowed) {
					respond(res, 499, requestId, { error: "cancelled_by_user" });
					return;
				}
				const result = await removeWorkspace({ ...parsed.data, projectId: removeProjectId });
				respond(res, 200, requestId, result);
				return;
			}
			case "POST /workspaces.set_status": {
				const body = await readJson(req);
				const parsed = setStatusRequestSchema.safeParse(body);
				if (!parsed.success) {
					respond(res, 400, requestId, { error: "validation", details: parsed.error.flatten() });
					return;
				}
				const caller = resolveCaller(req, null);
				if ("error" in caller) {
					respond(res, 401, requestId, { error: "unauthorized" });
					return;
				}
				respond(res, 200, requestId, await setStatus(caller, parsed.data));
				return;
			}

			case "POST /workspaces.send_message": {
				const body = await readJson(req);
				const parsed = sendMessageRequestSchema.safeParse(body);
				if (!parsed.success) {
					respond(res, 400, requestId, { error: "validation", details: parsed.error.flatten() });
					return;
				}
				const caller = resolveCaller(req, null);
				if ("error" in caller) {
					respond(res, 401, requestId, { error: "unauthorized" });
					return;
				}
				respond(res, 200, requestId, await sendMessage(caller, parsed.data));
				return;
			}

			case "GET /workspaces.read_messages": {
				const parsed = readMessagesRequestSchema.safeParse({
					since: url.searchParams.get("since") ?? undefined,
					includeBroadcasts: url.searchParams.get("includeBroadcasts") !== "false",
				});
				if (!parsed.success) {
					respond(res, 400, requestId, { error: "validation", details: parsed.error.flatten() });
					return;
				}
				const caller = resolveCaller(req, url.searchParams.get("projectId"));
				if ("error" in caller) {
					respond(res, 401, requestId, { error: "unauthorized" });
					return;
				}
				respond(res, 200, requestId, await readMessages(caller, parsed.data));
				return;
			}

			case "POST /workspaces.resume_agent": {
				const body = await readJson(req);
				const parsed = resumeAgentRequestSchema.safeParse(body);
				if (!parsed.success) {
					respond(res, 400, requestId, { error: "validation", details: parsed.error.flatten() });
					return;
				}
				const caller = resolveCaller(req, null);
				if ("error" in caller) {
					respond(res, 401, requestId, { error: "unauthorized" });
					return;
				}
				respond(res, 200, requestId, await resumeAgent(caller, parsed.data));
				return;
			}

			case "GET /events.poll": {
				const parsed = eventsPollRequestSchema.safeParse({
					afterSeq: url.searchParams.get("afterSeq") ?? undefined,
					waitMs: url.searchParams.get("waitMs") ?? undefined,
				});
				if (!parsed.success) {
					respond(res, 400, requestId, { error: "validation", details: parsed.error.flatten() });
					return;
				}
				const caller = resolveCaller(req, null);
				if ("error" in caller) {
					respond(res, 401, requestId, { error: "unauthorized" });
					return;
				}
				const eventsFile = eventsFileForCaller(caller);
				if (!eventsFile) {
					respond(res, 403, requestId, { error: "forbidden" });
					return;
				}
				let afterSeq = parsed.data.afterSeq;
				const deadline = Date.now() + parsed.data.waitMs;
				let clientGone = false;
				req.on("close", () => {
					clientGone = true;
				});
				const tail = new EventFileTail(eventsFile);
				for (;;) {
					const lines = tail.refresh();
					// File shrank (orchestrator reset) — restart the cursor.
					if (lines.length < afterSeq) afterSeq = 0;
					if (lines.length > afterSeq || Date.now() >= deadline) {
						if (clientGone) return;
						const events = lines
							.slice(afterSeq)
							.map((l) => {
								try {
									return JSON.parse(l) as unknown;
								} catch {
									return null;
								}
							})
							.filter((v) => v !== null);
						respond(res, 200, requestId, { events, nextSeq: lines.length });
						return;
					}
					if (clientGone) return;
					await new Promise<void>((r) => setTimeout(r, 500));
				}
			}

			case "GET /projects.list": {
				const caller = resolveCaller(req, null);
				if ("error" in caller) {
					respond(res, 401, requestId, { error: "unauthorized" });
					return;
				}
				const ids = caller.kind === "xro" ? caller.linkedProjectIds : [caller.projectId];
				const rows =
					ids.length > 0
						? getDb()
								.select({
									id: projects.id,
									name: projects.name,
									repoPath: projects.repoPath,
									defaultBranch: projects.defaultBranch,
									kind: projects.kind,
								})
								.from(projects)
								.where(inArray(projects.id, ids))
								.all()
						: [];
				respond(res, 200, requestId, { projects: rows });
				return;
			}

			case "GET /workspaces.agent_output": {
				const parsed = agentOutputRequestSchema.safeParse({
					workspaceId: url.searchParams.get("workspaceId"),
					lines: url.searchParams.get("lines") ?? undefined,
				});
				if (!parsed.success) {
					respond(res, 400, requestId, { error: "validation", details: parsed.error.flatten() });
					return;
				}
				const outputScope = resolveScopedProjectId(
					req,
					res,
					requestId,
					undefined,
					parsed.data.workspaceId
				);
				if (!outputScope) return;
				// v1 source: the workspace's most recently flushed terminal scrollback.
				// Persisted on the daemon's cadence, so it may lag the live terminal.
				// Sessions without scrollback (never-flushed panes) are excluded so a
				// freshly opened shell can't shadow the agent terminal with null.
				const session = getDb()
					.select({
						scrollback: terminalSessions.scrollback,
						updatedAt: terminalSessions.updatedAt,
					})
					.from(terminalSessions)
					.where(
						and(
							eq(terminalSessions.workspaceId, parsed.data.workspaceId),
							isNotNull(terminalSessions.scrollback)
						)
					)
					.orderBy(desc(terminalSessions.updatedAt))
					.get();
				if (!session?.scrollback) {
					respond(res, 200, requestId, {
						workspaceId: parsed.data.workspaceId,
						output: null,
						capturedAt: null,
					});
					return;
				}
				const tail = stripAnsi(session.scrollback).split("\n").slice(-parsed.data.lines).join("\n");
				respond(res, 200, requestId, {
					workspaceId: parsed.data.workspaceId,
					output: tail,
					capturedAt: session.updatedAt.toISOString(),
				});
				return;
			}

			case "GET /workspaces.watch": {
				const caller = resolveCaller(req, url.searchParams.get("projectId"));
				if ("error" in caller) {
					respond(res, 401, requestId, { error: "unauthorized" });
					return;
				}
				// Cross-repo orchestrators use file-based event aggregation rather
				// than per-project SSE; reject the SSE subscription gracefully.
				if (caller.kind === "xro") {
					respond(res, 400, requestId, { error: "xro_use_file_events" });
					return;
				}

				res.writeHead(200, {
					"Content-Type": "text/event-stream",
					"Cache-Control": "no-cache",
					Connection: "keep-alive",
				});

				const unsubscribe = deps.eventBus.subscribe(caller.projectId, (ev) => {
					res.write(`data: ${JSON.stringify(ev)}\n\n`);
				});

				const heartbeat = setInterval(() => {
					res.write(
						`data: ${JSON.stringify({ event: "heartbeat", ts: new Date().toISOString() })}\n\n`
					);
				}, 30_000);

				req.on("close", () => {
					clearInterval(heartbeat);
					unsubscribe();
				});

				return; // do NOT call respond — connection stays open
			}
			default:
				respond(res, 404, requestId, { error: "not_found" });
		}
	} catch (err) {
		if (err instanceof ResumeNotSupportedError) {
			respond(res, 409, requestId, { error: "resume_not_supported" });
			return;
		}
		if (err instanceof ForbiddenError) {
			respond(res, 403, requestId, { error: "forbidden" });
			return;
		}
		if (err instanceof NotFoundError) {
			respond(res, 404, requestId, { error: "not_found" });
			return;
		}
		console.error(`[control-plane] internal error request_id=${requestId}:`, err);
		respond(res, 500, requestId, { error: "internal" });
	}
}

function respond(
	res: ServerResponse,
	status: number,
	requestId: string,
	body: Record<string, unknown>
): void {
	res.writeHead(status, { "Content-Type": "application/json", "X-Request-Id": requestId });
	res.end(JSON.stringify({ ...body, request_id: requestId }));
}

async function readJson(req: IncomingMessage, maxBytes = 1_048_576): Promise<unknown> {
	const chunks: Buffer[] = [];
	let bytes = 0;
	let oversized = false;
	for await (const c of req) {
		const chunk = c as Buffer;
		bytes += chunk.byteLength;
		if (bytes > maxBytes) {
			oversized = true;
			continue;
		}
		chunks.push(chunk);
	}
	if (oversized) return null;
	const raw = Buffer.concat(chunks).toString("utf-8");
	if (!raw) return {};
	try {
		return JSON.parse(raw);
	} catch {
		return {};
	}
}
