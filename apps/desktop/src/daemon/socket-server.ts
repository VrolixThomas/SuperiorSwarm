import { type Server, type Socket, createServer } from "node:net";
import type { ClientMessage, DaemonMessage } from "../shared/daemon-protocol";
import type { PtyManager } from "./pty-manager";
import type { ScrollbackStore } from "./scrollback-store";

const MAX_INBOUND_FRAME_BYTES = 64_000;

export class SocketServer {
	private server: Server;
	private clients = new Map<string, Socket>();
	private clientIdCounter = 0;

	constructor(
		private ptyManager: PtyManager,
		private scrollbackStore: ScrollbackStore,
		private socketPath: string
	) {
		this.server = createServer((socket) => this.onConnection(socket));
	}

	listen(): void {
		this.server.listen(this.socketPath);
	}

	close(): void {
		this.server.close();
		for (const socket of this.clients.values()) {
			socket.destroy();
		}
		this.clients.clear();
	}

	get clientCount(): number {
		return this.clients.size;
	}

	flush(): void {
		const buffers = this.ptyManager.getAllBuffers();
		this.scrollbackStore.flush(buffers);
	}

	private onConnection(socket: Socket): void {
		const clientId = `client-${++this.clientIdCounter}`;
		this.clients.set(clientId, socket);

		this.send(socket, { type: "ready" });

		let lineBuffer = "";
		let droppingOversizedFrame = false;
		socket.on("data", (chunk) => {
			let inbound = chunk.toString("utf-8");

			if (droppingOversizedFrame) {
				const newlineInDrop = inbound.indexOf("\n");
				if (newlineInDrop === -1) {
					return;
				}
				droppingOversizedFrame = false;
				inbound = inbound.slice(newlineInDrop + 1);
			}

			lineBuffer += inbound;
			for (;;) {
				const newline = lineBuffer.indexOf("\n");
				if (newline === -1) break;
				const rawLine = lineBuffer.slice(0, newline);
				lineBuffer = lineBuffer.slice(newline + 1);
				if (rawLine.length > MAX_INBOUND_FRAME_BYTES) {
					console.warn(
						`[socket-server] oversized inbound frame (>${MAX_INBOUND_FRAME_BYTES}B), dropping line`
					);
					continue;
				}
				const line = rawLine.trim();
				if (!line) continue;
				try {
					const msg = JSON.parse(line) as ClientMessage;
					this.handleMessage(clientId, socket, msg);
				} catch {
					console.warn("[socket-server] failed to parse message from client");
				}
			}

			if (lineBuffer.length > MAX_INBOUND_FRAME_BYTES) {
				console.warn(
					`[socket-server] oversized inbound frame (>${MAX_INBOUND_FRAME_BYTES}B), discarding until newline`
				);
				lineBuffer = "";
				droppingOversizedFrame = true;
			}
		});

		socket.on("close", () => {
			this.clients.delete(clientId);
			this.ptyManager.detachClient(clientId);
			this.flush();
		});

		socket.on("error", () => {
			// handled by close event
		});
	}

	private handleMessage(clientId: string, socket: Socket, msg: ClientMessage): void {
		switch (msg.type) {
			case "list": {
				this.send(socket, { type: "sessions", sessions: this.ptyManager.list() });
				break;
			}
			case "create": {
				try {
					this.ptyManager.create(
						msg.id,
						msg.cwd,
						(data) => {
							this.send(socket, {
								type: "data",
								id: msg.id,
								data: Buffer.from(data, "utf-8").toString("base64"),
							});
						},
						(code, finalBuffer) => {
							this.send(socket, { type: "exit", id: msg.id, code });
							if (finalBuffer.length > 0) {
								this.scrollbackStore.flush([{ id: msg.id, buffer: finalBuffer }]);
							}
						},
						clientId,
						msg.env
					);
				} catch (err) {
					this.send(socket, { type: "error", id: msg.id, message: String(err) });
				}
				break;
			}
			case "attach": {
				const buffered = this.ptyManager.attach(
					msg.id,
					(data) => {
						this.send(socket, {
							type: "data",
							id: msg.id,
							data: Buffer.from(data, "utf-8").toString("base64"),
						});
					},
					(code, finalBuffer) => {
						this.send(socket, { type: "exit", id: msg.id, code });
						if (finalBuffer.length > 0) {
							this.scrollbackStore.flush([{ id: msg.id, buffer: finalBuffer }]);
						}
					},
					clientId
				);
				if (buffered === null) {
					this.send(socket, { type: "error", id: msg.id, message: "session not found" });
				} else if (buffered.length > 0) {
					this.send(socket, {
						type: "data",
						id: msg.id,
						data: Buffer.from(buffered, "utf-8").toString("base64"),
					});
				}
				break;
			}
			case "write": {
				this.ptyManager.write(msg.id, msg.data);
				break;
			}
			case "resize": {
				this.ptyManager.resize(msg.id, msg.cols, msg.rows);
				break;
			}
			case "dispose": {
				const buf = this.ptyManager.getBuffer(msg.id);
				const session = this.ptyManager.list().find((s) => s.id === msg.id);
				if (buf.length > 0 && session) {
					this.scrollbackStore.flush([{ id: msg.id, buffer: buf }]);
				}
				this.ptyManager.dispose(msg.id);
				break;
			}
			case "detach": {
				this.ptyManager.detachClient(clientId);
				break;
			}
			case "detach-all": {
				this.flush();
				this.ptyManager.detachClient(clientId);
				break;
			}
		}
	}

	private send(socket: Socket, msg: DaemonMessage): void {
		if (!socket.destroyed) {
			const ok = socket.write(`${JSON.stringify(msg)}\n`);
			if (!ok) {
				console.warn("[socket-server] socket backpressure detected");
			}
		}
	}
}
