import { type Server, type Socket, createServer } from "node:net";
import type { ClientMessage, DaemonMessage } from "../shared/daemon-protocol";
import type { PtyManager } from "./pty-manager";
import type { ScrollbackStore } from "./scrollback-store";

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

	flush(): void {
		const buffers = this.ptyManager.getAllBuffers();
		this.scrollbackStore.flush(buffers);
		for (const { id } of buffers) {
			this.ptyManager.resetBuffer(id);
		}
	}

	private onConnection(socket: Socket): void {
		const clientId = `client-${++this.clientIdCounter}`;
		this.clients.set(clientId, socket);

		this.send(socket, { type: "ready" });

		let lineBuffer = "";
		socket.on("data", (chunk) => {
			lineBuffer += chunk.toString("utf-8");
			if (lineBuffer.length > 64_000) {
				console.warn("[socket-server] line buffer overflow, resetting");
				lineBuffer = "";
				return;
			}
			for (;;) {
				const newline = lineBuffer.indexOf("\n");
				if (newline === -1) break;
				const line = lineBuffer.slice(0, newline).trim();
				lineBuffer = lineBuffer.slice(newline + 1);
				if (!line) continue;
				try {
					const msg = JSON.parse(line) as ClientMessage;
					this.handleMessage(clientId, socket, msg);
				} catch {
					console.warn("[socket-server] failed to parse message from client");
				}
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
								this.scrollbackStore.flush([{ id: msg.id, cwd: "", buffer: finalBuffer }]);
							}
						},
						clientId
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
							this.scrollbackStore.flush([{ id: msg.id, cwd: "", buffer: finalBuffer }]);
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
					this.scrollbackStore.flush([{ id: msg.id, cwd: session.cwd, buffer: buf }]);
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
			socket.write(`${JSON.stringify(msg)}\n`);
		}
	}
}
