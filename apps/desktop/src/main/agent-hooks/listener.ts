// src/main/agent-hooks/listener.ts
import { type Server, createServer } from "node:http";
import { type AgentEvent, agentRegistry } from "../../shared/agent-events";

type EventHandler = (event: AgentEvent) => void;

export interface AgentAlertListener {
	start: () => Promise<void>;
	stop: () => void;
	onEvent: (handler: EventHandler) => () => void;
}

export function createAlertListener(port: number): AgentAlertListener {
	const handlers = new Set<EventHandler>();
	let server: Server | null = null;

	const httpServer = createServer((req, res) => {
		const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);

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
				console.error("[agent-listener] handler error:", err);
			}
		}

		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ ok: true, alert }));
	});

	return {
		start() {
			return new Promise<void>((resolve, reject) => {
				server = httpServer;
				httpServer.once("error", reject);
				httpServer.listen(port, "127.0.0.1", () => {
					httpServer.removeListener("error", reject);
					httpServer.on("error", (err) => {
						console.error("[agent-listener] server error:", err);
					});
					resolve();
				});
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
	};
}
