import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";
import { eq } from "drizzle-orm";
import {
	ForbiddenError,
	NotFoundError,
	ResumeNotSupportedError,
	createWorkspaceRequestSchema,
	dispatchAgentRequestSchema,
	getWorkspaceRequestSchema,
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
	workspaces,
	worktrees,
} from "../db/schema";
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
import { isValidBearer } from "./auth";
import type { EventBus } from "./event-bus";
import { crossRepoEventsFilePath, eventsFilePathForProject } from "./orchestrator-event-sink";
import type { TaskRegistry } from "./task-registry";

function resolveProjectIdFromWorkspace(workspaceId: string): string | null {
	return (
		getDb()
			.select({ projectId: workspaces.projectId })
			.from(workspaces)
			.where(eq(workspaces.id, workspaceId))
			.get()?.projectId ?? null
	);
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
			.select({ id: crossRepoOrchestrators.id })
			.from(crossRepoOrchestrators)
			.where(eq(crossRepoOrchestrators.id, xroId))
			.get();
		if (!row) return { error: "unknown cross-repo orchestrator" };
		const linkedProjectIds = getDb()
			.select({ projectId: crossRepoOrchestratorProjects.projectId })
			.from(crossRepoOrchestratorProjects)
			.where(eq(crossRepoOrchestratorProjects.orchestratorId, xroId))
			.all()
			.map((r) => r.projectId);
		if (projectIdHint && !linkedProjectIds.includes(projectIdHint)) {
			return { error: "project not linked to this cross-repo orchestrator" };
		}
		return { kind: "xro", xroId, linkedProjectIds };
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
				const taskToken = url.searchParams.get("taskToken");
				if (taskToken) {
					const reg = deps.taskRegistry.consume(taskToken);
					if (reg) {
						respond(res, 200, requestId, reg);
						return;
					}
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
					const xro = getDb()
						.select({
							id: crossRepoOrchestrators.id,
							workDir: crossRepoOrchestrators.workDir,
						})
						.from(crossRepoOrchestrators)
						.all()
						.find((r) => {
							try {
								return realpathSync(r.workDir) === realCwd;
							} catch {
								return r.workDir === realCwd;
							}
						});
					if (xro) {
						const linkedProjectIds = getDb()
							.select({ projectId: crossRepoOrchestratorProjects.projectId })
							.from(crossRepoOrchestratorProjects)
							.where(eq(crossRepoOrchestratorProjects.orchestratorId, xro.id))
							.all()
							.map((r) => r.projectId);
						respond(res, 200, requestId, {
							mode: "cross-repo-orchestrator",
							crossRepoOrchestratorId: xro.id,
							linkedProjectIds,
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
			case "GET /workspaces.list": {
				const projectIdsRaw = url.searchParams.get("projectIds");
				if (projectIdsRaw) {
					const ids = projectIdsRaw.split(",").filter(Boolean);
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
				let getProjectId = parsed.data.projectId;
				if (!getProjectId) {
					const derived = resolveProjectIdFromWorkspace(parsed.data.workspaceId);
					if (!derived) {
						respond(res, 404, requestId, { error: "not_found" });
						return;
					}
					getProjectId = derived;
				}
				respond(
					res,
					200,
					requestId,
					await getWorkspace({ ...parsed.data, projectId: getProjectId })
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
				let dispatchProjectId = parsed.data.projectId;
				if (!dispatchProjectId) {
					const derived = resolveProjectIdFromWorkspace(parsed.data.workspaceId);
					if (!derived) {
						respond(res, 404, requestId, { error: "not_found" });
						return;
					}
					dispatchProjectId = derived;
				}
				const ws = await getWorkspace({
					projectId: dispatchProjectId,
					workspaceId: parsed.data.workspaceId,
				});
				const allowed = await deps.confirm({
					kind: "dispatch",
					workspaceName: ws.name,
					branch: ws.branch,
					summary: `Run "${parsed.data.cliPreset ?? "claude"}" with prompt: ${parsed.data.prompt.slice(0, 200)}`,
				});
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
				let removeProjectId = parsed.data.projectId;
				if (!removeProjectId) {
					const derived = resolveProjectIdFromWorkspace(parsed.data.workspaceId);
					if (!derived) {
						respond(res, 404, requestId, { error: "not_found" });
						return;
					}
					removeProjectId = derived;
				}
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
					includeBroadcasts: url.searchParams.get("includeBroadcasts") === "false" ? false : true,
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

async function readJson(req: IncomingMessage): Promise<unknown> {
	const chunks: Buffer[] = [];
	for await (const c of req) chunks.push(c as Buffer);
	const raw = Buffer.concat(chunks).toString("utf-8");
	if (!raw) return {};
	try {
		return JSON.parse(raw);
	} catch {
		return {};
	}
}
