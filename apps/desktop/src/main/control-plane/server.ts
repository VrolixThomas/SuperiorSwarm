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
	memoryAddFollowupRequestSchema,
	memoryAddGoalRequestSchema,
	memoryAddQuestionRequestSchema,
	memoryAnswerQuestionRequestSchema,
	memoryJournalAppendRequestSchema,
	memoryJournalEndRequestSchema,
	memoryJournalStartRequestSchema,
	memoryListDecisionsRequestSchema,
	memoryListFollowupsRequestSchema,
	memoryListGoalsRequestSchema,
	memoryListQuestionsRequestSchema,
	memoryLogDecisionRequestSchema,
	memoryReadJournalRequestSchema,
	memoryRecentJournalsRequestSchema,
	memorySearchRequestSchema,
	readMessagesRequestSchema,
	removeWorkspaceRequestSchema,
	resumeAgentRequestSchema,
	sendMessageRequestSchema,
	setStatusRequestSchema,
} from "../../shared/control-plane";
import { getDb } from "../db";
import { workspaces, worktrees } from "../db/schema";
import { memory } from "../memory";
import type { FtsKind } from "../memory";
import {
	type CallerContext,
	type SpawnFn,
	createWorkspace,
	dispatchAgent,
	getWorkspace,
	listWorkspaces,
	readMessages,
	removeWorkspace,
	resumeAgent,
	sendMessage,
	setStatus,
} from "../services/workspace-service";
import { isValidBearer } from "./auth";
import type { EventBus } from "./event-bus";
import { eventsFilePathForProject } from "./orchestrator-event-sink";
import type { TaskRegistry } from "./task-registry";

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
	userDataPath: string;
}

function resolveCaller(
	req: IncomingMessage,
	projectIdHint: string | null
): CallerContext | { error: string } {
	const wsId = req.headers["x-workspace-id"];
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
	return { workspaceId: wsId, projectId: row.projectId };
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
						orchestratorEventsPath: isOrch
							? eventsFilePathForProject(row.projectId)
							: undefined,
						modeContext: {},
					});
					return;
				}
				respond(res, 200, requestId, { mode: "none" });
				return;
			}
			case "GET /workspaces.list": {
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
				const parsed = getWorkspaceRequestSchema.safeParse({
					projectId: url.searchParams.get("projectId"),
					workspaceId: url.searchParams.get("workspaceId"),
				});
				if (!parsed.success) {
					respond(res, 400, requestId, { error: "validation", details: parsed.error.flatten() });
					return;
				}
				respond(res, 200, requestId, await getWorkspace(parsed.data));
				return;
			}
			case "POST /workspaces.create": {
				const body = await readJson(req);
				const parsed = createWorkspaceRequestSchema.safeParse(body);
				if (!parsed.success) {
					respond(res, 400, requestId, { error: "validation", details: parsed.error.flatten() });
					return;
				}
				respond(res, 200, requestId, await createWorkspace(parsed.data));
				return;
			}
			case "POST /workspaces.dispatch": {
				const body = await readJson(req);
				const parsed = dispatchAgentRequestSchema.safeParse(body);
				if (!parsed.success) {
					respond(res, 400, requestId, { error: "validation", details: parsed.error.flatten() });
					return;
				}
				const ws = await getWorkspace({
					projectId: parsed.data.projectId,
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
				const result = await dispatchAgent(parsed.data, { spawnFn: deps.spawnFn });
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
				const ws = await getWorkspace({
					projectId: parsed.data.projectId,
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
				const result = await removeWorkspace(parsed.data);
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

			case "POST /memory.add_goal": {
				const body = await readJson(req);
				const parsed = memoryAddGoalRequestSchema.safeParse(body);
				if (!parsed.success) {
					respond(res, 400, requestId, { error: "validation", details: parsed.error.flatten() });
					return;
				}
				const caller = resolveCaller(req, null);
				if ("error" in caller) {
					respond(res, 401, requestId, { error: "unauthorized" });
					return;
				}
				respond(res, 200, requestId, memory.addGoal({ projectId: caller.projectId, ...parsed.data }));
				return;
			}

			case "GET /memory.list_goals": {
				const parsed = memoryListGoalsRequestSchema.safeParse({
					status: url.searchParams.get("status") ?? undefined,
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
				respond(res, 200, requestId, {
					goals: memory.listGoals({ projectId: caller.projectId, status: parsed.data.status }),
				});
				return;
			}

			case "POST /memory.add_followup": {
				const body = await readJson(req);
				const parsed = memoryAddFollowupRequestSchema.safeParse(body);
				if (!parsed.success) {
					respond(res, 400, requestId, { error: "validation", details: parsed.error.flatten() });
					return;
				}
				const caller = resolveCaller(req, null);
				if ("error" in caller) {
					respond(res, 401, requestId, { error: "unauthorized" });
					return;
				}
				respond(
					res,
					200,
					requestId,
					memory.addFollowup({
						projectId: caller.projectId,
						title: parsed.data.title,
						body: parsed.data.body ?? null,
						owner: parsed.data.owner ?? null,
						dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null,
						goalId: parsed.data.goalId ?? null,
					})
				);
				return;
			}

			case "GET /memory.list_followups": {
				const parsed = memoryListFollowupsRequestSchema.safeParse({
					status: url.searchParams.get("status") ?? undefined,
					owner: url.searchParams.get("owner") ?? undefined,
					dueBefore: url.searchParams.get("dueBefore") ?? undefined,
					dueAfter: url.searchParams.get("dueAfter") ?? undefined,
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
				respond(res, 200, requestId, {
					followups: memory.listFollowups({
						projectId: caller.projectId,
						status: parsed.data.status,
						owner: parsed.data.owner,
						dueBefore: parsed.data.dueBefore ? new Date(parsed.data.dueBefore) : undefined,
						dueAfter: parsed.data.dueAfter ? new Date(parsed.data.dueAfter) : undefined,
					}),
				});
				return;
			}

			case "POST /memory.log_decision": {
				const body = await readJson(req);
				const parsed = memoryLogDecisionRequestSchema.safeParse(body);
				if (!parsed.success) {
					respond(res, 400, requestId, { error: "validation", details: parsed.error.flatten() });
					return;
				}
				const caller = resolveCaller(req, null);
				if ("error" in caller) {
					respond(res, 401, requestId, { error: "unauthorized" });
					return;
				}
				respond(
					res,
					200,
					requestId,
					memory.logDecision({
						projectId: caller.projectId,
						title: parsed.data.title,
						rationale: parsed.data.rationale,
						alternatives: parsed.data.alternatives ?? null,
					})
				);
				return;
			}

			case "GET /memory.list_decisions": {
				const limitRaw = url.searchParams.get("limit");
				const parsed = memoryListDecisionsRequestSchema.safeParse({
					since: url.searchParams.get("since") ?? undefined,
					limit: limitRaw ? Number(limitRaw) : undefined,
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
				respond(res, 200, requestId, {
					decisions: memory.listDecisions({
						projectId: caller.projectId,
						since: parsed.data.since ? new Date(parsed.data.since) : undefined,
						limit: parsed.data.limit,
					}),
				});
				return;
			}

			case "POST /memory.add_question": {
				const body = await readJson(req);
				const parsed = memoryAddQuestionRequestSchema.safeParse(body);
				if (!parsed.success) {
					respond(res, 400, requestId, { error: "validation", details: parsed.error.flatten() });
					return;
				}
				const caller = resolveCaller(req, null);
				if ("error" in caller) {
					respond(res, 401, requestId, { error: "unauthorized" });
					return;
				}
				respond(
					res,
					200,
					requestId,
					memory.addQuestion({
						projectId: caller.projectId,
						question: parsed.data.question,
						context: parsed.data.context ?? null,
					})
				);
				return;
			}

			case "POST /memory.answer_question": {
				const body = await readJson(req);
				const parsed = memoryAnswerQuestionRequestSchema.safeParse(body);
				if (!parsed.success) {
					respond(res, 400, requestId, { error: "validation", details: parsed.error.flatten() });
					return;
				}
				const caller = resolveCaller(req, null);
				if ("error" in caller) {
					respond(res, 401, requestId, { error: "unauthorized" });
					return;
				}
				memory.answerQuestion(parsed.data);
				respond(res, 200, requestId, { ok: true });
				return;
			}

			case "GET /memory.list_questions": {
				const parsed = memoryListQuestionsRequestSchema.safeParse({
					status: url.searchParams.get("status") ?? undefined,
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
				respond(res, 200, requestId, {
					questions: memory.listQuestions({
						projectId: caller.projectId,
						status: parsed.data.status,
					}),
				});
				return;
			}

			case "POST /memory.journal_start": {
				const caller = resolveCaller(req, null);
				if ("error" in caller) {
					respond(res, 401, requestId, { error: "unauthorized" });
					return;
				}
				respond(
					res,
					200,
					requestId,
					memory.journalStart({
						userDataPath: deps.userDataPath,
						projectId: caller.projectId,
					})
				);
				return;
			}

			case "POST /memory.journal_append": {
				const body = await readJson(req);
				const parsed = memoryJournalAppendRequestSchema.safeParse(body);
				if (!parsed.success) {
					respond(res, 400, requestId, { error: "validation", details: parsed.error.flatten() });
					return;
				}
				const caller = resolveCaller(req, null);
				if ("error" in caller) {
					respond(res, 401, requestId, { error: "unauthorized" });
					return;
				}
				memory.journalAppend(parsed.data);
				respond(res, 200, requestId, { ok: true });
				return;
			}

			case "POST /memory.journal_end": {
				const body = await readJson(req);
				const parsed = memoryJournalEndRequestSchema.safeParse(body);
				if (!parsed.success) {
					respond(res, 400, requestId, { error: "validation", details: parsed.error.flatten() });
					return;
				}
				const caller = resolveCaller(req, null);
				if ("error" in caller) {
					respond(res, 401, requestId, { error: "unauthorized" });
					return;
				}
				memory.journalEnd(parsed.data);
				respond(res, 200, requestId, { ok: true });
				return;
			}

			case "GET /memory.read_journal": {
				const parsed = memoryReadJournalRequestSchema.safeParse({
					sessionId: url.searchParams.get("sessionId") ?? undefined,
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
				respond(res, 200, requestId, {
					content: memory.readJournal(parsed.data),
				});
				return;
			}

			case "GET /memory.recent_journals": {
				const limitRaw = url.searchParams.get("limit");
				const parsed = memoryRecentJournalsRequestSchema.safeParse({
					limit: limitRaw ? Number(limitRaw) : undefined,
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
				respond(res, 200, requestId, {
					journals: memory.recentJournals({
						projectId: caller.projectId,
						limit: parsed.data.limit,
					}),
				});
				return;
			}

			case "GET /memory.search": {
				const limitRaw = url.searchParams.get("limit");
				const kindsRaw = url.searchParams.get("kinds");
				const parsed = memorySearchRequestSchema.safeParse({
					query: url.searchParams.get("query") ?? undefined,
					kinds: kindsRaw ? (kindsRaw.split(",") as FtsKind[]) : undefined,
					limit: limitRaw ? Number(limitRaw) : undefined,
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
				respond(res, 200, requestId, {
					hits: memory.search({
						projectId: caller.projectId,
						query: parsed.data.query,
						kinds: parsed.data.kinds,
						limit: parsed.data.limit,
					}),
				});
				return;
			}

			case "GET /workspaces.watch": {
				const caller = resolveCaller(req, url.searchParams.get("projectId"));
				if ("error" in caller) {
					respond(res, 401, requestId, { error: "unauthorized" });
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
