import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";
import { randomUUID } from "node:crypto";
import {
	createWorkspaceRequestSchema,
	dispatchAgentRequestSchema,
	getWorkspaceRequestSchema,
	listWorkspacesRequestSchema,
	removeWorkspaceRequestSchema,
} from "../../shared/control-plane";
import {
	type SpawnFn,
	createWorkspace,
	dispatchAgent,
	getWorkspace,
	listWorkspaces,
	removeWorkspace,
} from "../services/workspace-service";
import { isValidBearer } from "./auth";

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

function isLoopback(addr: string | undefined): boolean {
	if (!addr) return true; // unknown — trust by default (loopback-only bind)
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
			default:
				respond(res, 404, requestId, { error: "not_found" });
		}
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (/^forbidden(:|$)/i.test(msg)) {
			respond(res, 403, requestId, { error: "forbidden" });
			return;
		}
		if (/^not_found(:|$)/i.test(msg)) {
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
		return null;
	}
}
