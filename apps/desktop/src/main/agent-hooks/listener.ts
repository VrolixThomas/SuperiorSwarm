// src/main/agent-hooks/listener.ts
import { type Server, createServer } from "node:http";
import { type AgentEvent, agentRegistry } from "../../shared/agent-events";
import { validateAgentEvidence } from "../../shared/agent-evidence";
import { log } from "../logger";
import { permissionProcessAlive } from "./permission-process";
import type { PermissionTarget, QueuePermissions } from "./queue-permissions";

function parseProducerTimestamp(value: string | null): number | undefined {
	if (!value) return undefined;
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= Date.now() + 60_000
		? parsed
		: undefined;
}

const APP_IDENTIFIER = "superiorswarm";

type EventHandler = (event: AgentEvent) => void;

export interface AgentAlertListener {
	start: () => Promise<void>;
	stop: () => void;
	onEvent: (handler: EventHandler) => () => void;
	getPort: () => number | null;
}

export function createAlertListener(
	port: number,
	authToken?: string,
	permissionChannel?: {
		service: QueuePermissions;
		resolve: (event: AgentEvent) => { target: PermissionTarget; generation: string } | null;
	}
): AgentAlertListener {
	const handlers = new Set<EventHandler>();
	let server: Server | null = null;

	const httpServer = createServer(async (req, res) => {
		const url = new URL(req.url ?? "/", "http://127.0.0.1");

		if (url.pathname === "/health") {
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ ok: true, app: APP_IDENTIFIER }));
			return;
		}

		if (url.pathname === "/shutdown") {
			if (req.method !== "POST") {
				res.writeHead(405, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ ok: false, error: "method not allowed" }));
				return;
			}
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ ok: true }));
			server?.close();
			server = null;
			return;
		}

		if (url.pathname !== "/event" && url.pathname !== "/permission-receipt") {
			res.writeHead(404, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ ok: false, error: "not found" }));
			return;
		}

		if (authToken && req.headers.authorization !== `Bearer ${authToken}`) {
			res.writeHead(401, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ ok: false, error: "unauthorized" }));
			return;
		}

		let body: Record<string, unknown> = {};
		if (req.method === "POST") {
			try {
				let size = 0;
				const chunks: Buffer[] = [];
				for await (const chunk of req) {
					size += chunk.length;
					if (size > 32768) {
						res.writeHead(413);
						res.end();
						return;
					}
					chunks.push(Buffer.from(chunk));
				}
				const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
				if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
					throw new Error("invalid body");
				body = parsed;
				for (const [key, value] of Object.entries(body)) {
					if (typeof value === "string") url.searchParams.set(key, value);
				}
			} catch {
				res.writeHead(400);
				res.end();
				return;
			}
		}
		if (url.pathname === "/permission-receipt") {
			const accepted =
				!!authToken &&
				req.method === "POST" &&
				typeof body["requestId"] === "string" &&
				typeof body["receipt"] === "string" &&
				permissionChannel?.service.received(body["requestId"], body["receipt"]);
			res.writeHead(accepted ? 200 : 409);
			res.end();
			return;
		}
		const rawEvent = url.searchParams.get("rawEvent");
		const terminalId =
			url.searchParams.get("terminalId") ?? url.searchParams.get("sessionId") ?? "";
		const providerSessionId = url.searchParams.get("providerSessionId") ?? "";
		const workspaceId = url.searchParams.get("workspaceId") ?? "";
		const cwd = url.searchParams.get("cwd") ?? "";
		const agent = url.searchParams.get("agent") ?? "";

		if (!rawEvent) {
			res.writeHead(400, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ ok: false, error: "missing rawEvent param" }));
			return;
		}

		const config = agentRegistry.get(agent);
		if (!config) {
			res.writeHead(204);
			res.end();
			return;
		}

		const alert = config.mapEvent(rawEvent);
		if (!alert) {
			res.writeHead(204);
			res.end();
			return;
		}

		const event: AgentEvent = {
			sessionId: terminalId,
			terminalId,
			providerSessionId,
			workspaceId,
			cwd,
			alert,
			agent,
			timestamp: Date.now(),
			rawEvent,
			turnId: url.searchParams.get("turnId") || undefined,
			sessionSource: url.searchParams.get("sessionSource") || undefined,
			producerTimestamp: parseProducerTimestamp(url.searchParams.get("producerTimestamp")),
			providerTimestamp: parseProducerTimestamp(url.searchParams.get("providerTimestamp")),
			providerEventId: url.searchParams.get("providerEventId")?.slice(0, 256) || undefined,
			evidence: validateAgentEvidence(body["evidence"], agent, rawEvent),
			// Registered hooks report requests, not decisions. Generic tool activity/Stop
			// must never be promoted to an allowed/denied permission outcome.
			permission:
				rawEvent === "PermissionRequest"
					? {
							outcome: "pending",
							requestId:
								typeof (body["permission"] as { requestId?: unknown })?.requestId === "string"
									? (body["permission"] as { requestId: string }).requestId.slice(0, 256)
									: undefined,
						}
					: undefined,
		};

		for (const handler of handlers) {
			try {
				handler(event);
			} catch (err) {
				log.error("[agent-notify] handler error:", err);
			}
		}

		if (
			authToken &&
			req.method === "POST" &&
			body["permissionResponse"] === 1 &&
			rawEvent === "PermissionRequest" &&
			permissionChannel &&
			event.permission?.requestId &&
			event.producerTimestamp &&
			Math.abs(Date.now() - event.producerTimestamp) < 5000
		) {
			const binding = permissionChannel.resolve(event);
			if (
				binding &&
				permissionProcessAlive(body["providerProcess"]) &&
				permissionChannel.service.register({
					...binding,
					issuedAt: event.producerTimestamp,
					allowOnce:
						body["actionReviewable"] === true &&
						typeof body["actionSummary"] === "string" &&
						body["actionSummary"].length <= 2048,
					alive: () => permissionProcessAlive(body["providerProcess"]),
					requestId: event.permission.requestId,
					summary:
						typeof body["actionSummary"] === "string"
							? (validateAgentEvidence(
									[{ sourceField: "permission_prompt", text: body["actionSummary"] }],
									agent,
									rawEvent
								)[0]?.text ?? "Requested action details unavailable")
							: "Requested action details unavailable",
					reply: (value) => {
						if (res.destroyed || res.writableEnded) return false;
						res.writeHead(200, { "Content-Type": "application/json" });
						res.end(JSON.stringify(value));
						return true;
					},
				})
			) {
				const id = event.permission.requestId;
				res.on("close", () => {
					if (!res.writableFinished) permissionChannel.service.disconnected(id);
				});
				req.socket.once("close", () => {
					if (!res.writableFinished) permissionChannel.service.disconnected(id);
				});
				return;
			}
		}
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ ok: true, alert }));
	});

	return {
		start() {
			return new Promise<void>((resolve, reject) => {
				server = httpServer;

				const bind = (targetPort: number) => {
					const onBindError = (err: NodeJS.ErrnoException) => {
						if (err.code === "EADDRINUSE" && targetPort !== 0) {
							log.warn(
								`[agent-notify] port ${targetPort} in use, falling back to OS-assigned port`
							);
							bind(0);
						} else {
							reject(err);
						}
					};
					httpServer.once("error", onBindError);
					httpServer.listen(targetPort, "127.0.0.1", () => {
						httpServer.removeListener("error", onBindError);
						httpServer.on("error", (err) => {
							log.error("[agent-notify] server error:", err);
						});
						const addr = httpServer.address();
						const boundPort = typeof addr === "object" && addr ? addr.port : targetPort;
						log.info(`[agent-notify] listening on port ${boundPort}`);
						resolve();
					});
				};

				bind(port);
			});
		},
		stop() {
			permissionChannel?.service.close();
			server?.close();
			server = null;
		},
		onEvent(handler: EventHandler) {
			handlers.add(handler);
			return () => {
				handlers.delete(handler);
			};
		},
		getPort() {
			if (!server) return null;
			const addr = server.address();
			return typeof addr === "object" && addr ? addr.port : null;
		},
	};
}

/**
 * Try to reclaim the preferred port from a stale SuperiorSwarm listener.
 * Probes /health to verify it's ours, then sends POST /shutdown.
 * Best-effort: if the port is free or held by a non-SuperiorSwarm process,
 * this is a no-op and bind() will handle EADDRINUSE via fallback.
 */
export async function reclaimPort(port: number): Promise<void> {
	const base = `http://127.0.0.1:${port}`;
	try {
		const healthRes = await fetch(`${base}/health`, {
			signal: AbortSignal.timeout(1000),
		});
		if (!healthRes.ok) return;
		const body = (await healthRes.json()) as { app?: string };
		if (body.app !== APP_IDENTIFIER) return;

		log.info(`[agent-notify] shutting down stale listener on port ${port}`);
		await fetch(`${base}/shutdown`, {
			method: "POST",
			signal: AbortSignal.timeout(1000),
		}).catch(() => {});

		// Brief delay for the OS to release the port
		await new Promise((resolve) => setTimeout(resolve, 200));
	} catch {
		// Connection refused or timeout — port is free or held by non-HTTP process
	}
}
