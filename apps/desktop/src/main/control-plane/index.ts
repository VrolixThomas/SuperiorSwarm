import type { Server } from "node:http";
import type { SpawnFn } from "../services/workspace-service";
import { generateToken } from "./auth";
import { type ConfirmFn, createControlPlaneServer } from "./server";

export interface RunningControlPlane {
	port: number;
	token: string;
	stop: () => Promise<void>;
}

export interface StartOpts {
	confirm: ConfirmFn;
	spawnFn: SpawnFn;
	token?: string;
}

export async function startControlPlane(opts: StartOpts): Promise<RunningControlPlane> {
	const token = opts.token ?? generateToken();
	const server: Server = createControlPlaneServer({
		token,
		confirm: opts.confirm,
		spawnFn: opts.spawnFn,
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
		async stop() {
			await new Promise<void>((resolve) => server.close(() => resolve()));
		},
	};
}
