import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { type Socket, connect } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { resolveConfig } from "electron-vite";
import { build } from "vite";
import type { DaemonMessage } from "../src/shared/daemon-protocol";
import { TERMINAL_SNAPSHOT_CAPABILITY, decodeTerminalReplay } from "../src/shared/terminal-replay";

test("Vite-built daemon starts in Electron and creates a snapshot-capable terminal", async () => {
	const dir = await mkdtemp(join(tmpdir(), "ss-built-daemon-"));
	const desktop = resolve(import.meta.dir, "..");
	let child: Bun.Subprocess<"ignore", "pipe", "pipe"> | undefined;
	let socket: Socket | undefined;
	let deadline: ReturnType<typeof setTimeout> | undefined;
	try {
		const resolved = await resolveConfig(
			{
				root: desktop,
				configFile: join(desktop, "electron.vite.config.ts"),
				mode: "development",
				logLevel: "silent",
			},
			"build"
		);
		const main = resolved.config?.main;
		if (!main) throw Error("Missing desktop main-process build configuration");
		await build({
			...main,
			// These packaging hooks write into the workspace. This test needs only
			// the daemon bundle, with the real external-dependency/ESM configuration.
			plugins: main.plugins?.filter(
				(plugin) =>
					!(
						plugin &&
						typeof plugin === "object" &&
						"name" in plugin &&
						["copy-drizzle-migrations", "terminal-file-helper"].includes(String(plugin.name))
					)
			),
			build: {
				...main.build,
				outDir: join(dir, "out"),
				rollupOptions: {
					...main.build?.rollupOptions,
					input: { daemon: join(desktop, "src/daemon/index.ts") },
				},
			},
		});
		await writeFile(join(dir, "package.json"), '{"type":"module"}');
		await symlink(join(desktop, "node_modules"), join(dir, "node_modules"));
		const dbPath = join(dir, "test.db");
		const db = new Database(dbPath);
		db.exec(
			"CREATE TABLE terminal_sessions (id TEXT PRIMARY KEY, scrollback TEXT, updated_at INTEGER)"
		);
		db.exec("INSERT INTO terminal_sessions (id) VALUES ('test')");
		db.close();
		const electronDir = dirname(require.resolve("electron/package.json"));
		const executable = (await readFile(join(electronDir, "path.txt"), "utf8")).trim();
		const electron = join(
			process.env["ELECTRON_OVERRIDE_DIST_PATH"] || join(electronDir, "dist"),
			executable
		);
		const socketPath = join(dir, "daemon.sock");
		child = Bun.spawn([electron, join(dir, "out/daemon.js")], {
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
			env: {
				...process.env,
				ELECTRON_RUN_AS_NODE: "1",
				SHELL: "/bin/sh",
				SUPERIORSWARM_DB_PATH: dbPath,
				SUPERIORSWARM_SOCKET_PATH: socketPath,
				SUPERIORSWARM_PID_PATH: join(dir, "daemon.pid"),
				SUPERIORSWARM_OWNER_PATH: join(dir, "daemon.owner"),
				SUPERIORSWARM_APP_DIR_HASH: "isolated-startup-test",
				SUPERIORSWARM_DEV_MODE: "1",
			},
		});
		const stderr = new Response(child.stderr).text();
		const stdout = new Response(child.stdout).text();
		deadline = setTimeout(() => child?.kill(), 10000);
		const until = async (condition: () => boolean) => {
			for (let i = 0; i < 300; i++) {
				if (condition()) return;
				if (typeof child?.exitCode === "number") throw Error(`${await stdout}\n${await stderr}`);
				await Bun.sleep(20);
			}
			throw Error("Built daemon did not become ready");
		};
		await until(() => existsSync(socketPath));
		const messages: DaemonMessage[] = [];
		let incoming = "";
		socket = connect(socketPath);
		socket.setEncoding("utf8");
		socket.on("data", (data: string) => {
			incoming += data;
			for (let end = incoming.indexOf("\n"); end !== -1; end = incoming.indexOf("\n")) {
				messages.push(JSON.parse(incoming.slice(0, end)) as DaemonMessage);
				incoming = incoming.slice(end + 1);
			}
		});
		await until(() => messages.some((m) => m.type === "ready"));
		const ready = messages.find((m) => m.type === "ready");
		expect(
			ready?.type === "ready" && ready.capabilities?.includes(TERMINAL_SNAPSHOT_CAPABILITY)
		).toBe(true);
		socket.write(`${JSON.stringify({ type: "create", id: "test", cwd: dir })}\n`);
		socket.write(
			`${JSON.stringify({ type: "write", id: "test", data: "printf '\\137\\137daemon-ready\\137\\137\\n'\r" })}\n`
		);
		const hasOutput = () =>
			messages.some(
				(m) =>
					m.type === "data" &&
					Buffer.from(m.data, "base64").toString("utf8").includes("__daemon-ready__")
			);
		await until(hasOutput);
		socket.write(`${JSON.stringify({ type: "attach", id: "test", snapshot: true })}\n`);
		await until(() => messages.some((m) => m.type === "data" && m.replay));
		const replay = messages.find((m) => m.type === "data" && m.replay);
		if (replay?.type !== "data") throw Error("Missing replay");
		expect(
			decodeTerminalReplay(Buffer.from(replay.data, "base64").toString("utf8"))?.data
		).toContain("__daemon-ready__");
	} finally {
		if (deadline) clearTimeout(deadline);
		socket?.destroy();
		if (child) {
			child.kill("SIGTERM");
			await child.exited;
		}
		await rm(dir, { recursive: true, force: true });
	}
}, 30000);
