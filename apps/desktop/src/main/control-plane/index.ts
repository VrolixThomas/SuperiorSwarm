import type { Server } from "node:http";
import type { SpawnFn } from "../services/workspace-service";
import { generateToken } from "./auth";
import { EventBus } from "./event-bus";
import { type ConfirmFn, createControlPlaneServer } from "./server";

export interface RunningControlPlane {
	port: number;
	token: string;
	eventBus: EventBus;
	stop: () => Promise<void>;
}

export interface StartOpts {
	confirm: ConfirmFn;
	spawnFn: SpawnFn;
	token?: string;
	eventBus?: EventBus;
}

export async function startControlPlane(opts: StartOpts): Promise<RunningControlPlane> {
	const token = opts.token ?? generateToken();
	const eventBus = opts.eventBus ?? new EventBus();
	const server: Server = createControlPlaneServer({
		token,
		confirm: opts.confirm,
		spawnFn: opts.spawnFn,
		eventBus,
	});

	const port = await new Promise<number>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const addr = server.address();
			if (typeof addr === "object" && addr) resolve(addr.port);
			else reject(new Error("control-plane: bad address"));
		});
	});

	return {
		port,
		token,
		eventBus,
		async stop() {
			await new Promise<void>((resolve) => server.close(() => resolve()));
		},
	};
}
