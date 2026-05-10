import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";
import {
	createWorkspaceRequestSchema,
	dispatchAgentRequestSchema,
	getWorkspaceRequestSchema,
	listWorkspacesRequestSchema,
	removeWorkspaceRequestSchema,
} from "../../shared/control-plane";
import {
	createWorkspace,
	dispatchAgent,
	getWorkspace,
	listWorkspaces,
	removeWorkspace,
	type SpawnFn,
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
		void handleRequest(req, res, deps).catch((err) => {
			respond(res, 500, { error: "internal", message: String(err) });
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
	deps: ControlPlaneDeps
): Promise<void> {
	if (!isLoopback(req.socket.remoteAddress)) {
		respond(res, 401, { error: "unauthorized" });
		return;
	}
	if (!isValidBearer(req.headers.authorization, deps.token)) {
		respond(res, 401, { error: "unauthorized" });
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
					respond(res, 400, { error: "validation", details: parsed.error.flatten() });
					return;
				}
				respond(res, 200, await listWorkspaces(parsed.data));
				return;
			}
			case "GET /workspaces.get": {
				const parsed = getWorkspaceRequestSchema.safeParse({
					projectId: url.searchParams.get("projectId"),
					workspaceId: url.searchParams.get("workspaceId"),
				});
				if (!parsed.success) {
					respond(res, 400, { error: "validation", details: parsed.error.flatten() });
					return;
				}
				respond(res, 200, await getWorkspace(parsed.data));
				return;
			}
			case "POST /workspaces.create": {
				const body = await readJson(req);
				const parsed = createWorkspaceRequestSchema.safeParse(body);
				if (!parsed.success) {
					respond(res, 400, { error: "validation", details: parsed.error.flatten() });
					return;
				}
				respond(res, 200, await createWorkspace(parsed.data));
				return;
			}
			case "POST /workspaces.dispatch": {
				const body = await readJson(req);
				const parsed = dispatchAgentRequestSchema.safeParse(body);
				if (!parsed.success) {
					respond(res, 400, { error: "validation", details: parsed.error.flatten() });
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
					respond(res, 499, { error: "cancelled_by_user" });
					return;
				}
				const result = await dispatchAgent(parsed.data, { spawnFn: deps.spawnFn });
				respond(res, 200, result);
				return;
			}
			case "POST /workspaces.remove": {
				const body = await readJson(req);
				const parsed = removeWorkspaceRequestSchema.safeParse(body);
				if (!parsed.success) {
					respond(res, 400, { error: "validation", details: parsed.error.flatten() });
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
					respond(res, 499, { error: "cancelled_by_user" });
					return;
				}
				const result = await removeWorkspace(parsed.data);
				respond(res, 200, result);
				return;
			}
			default:
				respond(res, 404, { error: "not_found" });
		}
	} catch (err) {
		const msg = String(err);
		if (/forbidden/i.test(msg)) {
			respond(res, 403, { error: "forbidden" });
			return;
		}
		if (/not_found/i.test(msg)) {
			respond(res, 404, { error: "not_found", message: msg });
			return;
		}
		respond(res, 409, { error: "git_conflict", message: msg });
	}
}

function respond(res: ServerResponse, status: number, body: unknown): void {
	res.writeHead(status, { "Content-Type": "application/json" });
	res.end(JSON.stringify(body));
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
