// src/main/agent-hooks/listener.ts
import { type Server, createServer } from "node:http";
import { type AgentEvent, agentRegistry } from "../../shared/agent-events";

type EventHandler = (event: AgentEvent) => void;

export interface AgentAlertListener {
	start: () => Promise<void>;
	stop: () => void;
	onEvent: (handler: EventHandler) => () => void;
	getPort: () => number | null;
}

export function createAlertListener(port: number): AgentAlertListener {
	const handlers = new Set<EventHandler>();
	let server: Server | null = null;

	const httpServer = createServer((req, res) => {
		const url = new URL(req.url ?? "/", "http://127.0.0.1");

		if (url.pathname !== "/event") {
			res.writeHead(404, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ ok: false, error: "not found" }));
			return;
		}

		const rawEvent = url.searchParams.get("rawEvent");
		const sessionId = url.searchParams.get("sessionId") ?? "";
		const workspaceId = url.searchParams.get("workspaceId") ?? "";
		const agent = url.searchParams.get("agent") ?? "";

		if (!rawEvent) {
			res.writeHead(400, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ ok: false, error: "missing rawEvent param" }));
			return;
		}

		// Look up the agent's mapper
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
			sessionId,
			workspaceId,
			alert,
			agent,
			timestamp: Date.now(),
		};

		for (const handler of handlers) {
			try {
				handler(event);
			} catch (err) {
				console.error("[agent-notify] handler error:", err);
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
							console.warn(
								`[agent-notify] port ${targetPort} in use, falling back to OS-assigned port`,
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
							console.error("[agent-notify] server error:", err);
						});
						const addr = httpServer.address();
						const boundPort = typeof addr === "object" && addr ? addr.port : targetPort;
						console.log(`[agent-notify] listening on port ${boundPort}`);
						resolve();
					});
				};

				bind(port);
			});
		},
		stop() {
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
