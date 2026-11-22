import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { resolveConfig } from "electron-vite";
import { build as viteBuild } from "vite";

// Run after `bun run build`: production preload and CSS are used unchanged.
test.skipIf(process.env["SS_QUEUE_EXTERNAL_LAUNCH_NATIVE"] !== "1")(
	"external queue prepares and starts the exact native provider chat",
	async () => {
		const desktop = resolve(import.meta.dir, "..");
		const fixture = join(desktop, "tests/fixtures/queue-external-launch-native");
		const root = realpathSync(mkdtempSync(join(tmpdir(), "ss-ql-")));
		const keep = true;
		try {
			mkdirSync(join(root, "profile"));
			symlinkSync(join(desktop, "node_modules"), join(root, "node_modules"));
			writeFileSync(join(root, "package.json"), '{"type":"module"}');
			const preload = join(desktop, "out/preload/index.cjs");
			if (!existsSync(preload))
				throw new Error("Build the desktop before running the native queue fixture");
			copyFileSync(preload, join(root, "preload.cjs"));
			const css = readdirSync(join(desktop, "out/renderer/assets")).find(
				(name) => name.startsWith("index-") && name.endsWith(".css")
			);
			if (!css) throw new Error("Missing production CSS");
			copyFileSync(join(desktop, "out/renderer/assets", css), join(root, "index.css"));
			const resolved = await resolveConfig(
				{ root: desktop, configFile: join(desktop, "electron.vite.config.ts"), logLevel: "silent" },
				"build"
			);
			const main = resolved.config?.main;
			if (!main) throw new Error("Missing main build configuration");
			await viteBuild({
				...main,
				plugins: [
					{
						name: "fixture-hook-config-location",
						transform(code, id) {
							if (!id.endsWith("/activity-queue/hook-config.ts")) return;
							return code.replace(
								"openSync(join(root, QUEUE_HOOK_CONFIG)",
								'openSync(join(process.env["SS_QUEUE_FIXTURE_HOOK_CONFIG_ROOT"] ?? root, QUEUE_HOOK_CONFIG)'
							);
						},
					},
					...(main.plugins ?? []).filter(
						(plugin) =>
							!(
								plugin &&
								typeof plugin === "object" &&
								"name" in plugin &&
								["copy-drizzle-migrations", "terminal-file-helper"].includes(String(plugin.name))
							)
					),
				],
				build: {
					...main.build,
					outDir: join(root, "main"),
					rollupOptions: {
						...main.build?.rollupOptions,
						input: { main: join(fixture, "main.ts") },
					},
				},
			});
			copyFileSync(
				join(desktop, "out/main/terminal-process-info"),
				join(root, "main/terminal-process-info")
			);
			const renderer = await Bun.build({
				entrypoints: [join(fixture, "renderer.ts")],
				outdir: root,
				target: "browser",
				format: "esm",
				naming: "renderer.js",
			});
			if (!renderer.success) throw new Error(renderer.logs.map(String).join("\n"));
			writeFileSync(
				join(root, "index.html"),
				'<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="./index.css"></head><body style="background:#171717;color:#eee"><div id="root"></div><script type="module" src="./renderer.js"></script></body></html>'
			);
			const electronDir = dirname(require.resolve("electron/package.json"));
			const electronPath = join(
				process.env["ELECTRON_OVERRIDE_DIST_PATH"] || join(electronDir, "dist"),
				readFileSync(join(electronDir, "path.txt"), "utf8").trim()
			);
			const code = await new Promise<number | null>((done, reject) => {
				const child = spawn(electronPath, [join(root, "main/main.js")], {
					cwd: root,
					env: {
						...Object.fromEntries(
							Object.entries(process.env).filter(
								([key]) =>
									!key.startsWith("SUPERIORSWARM_") &&
									!key.startsWith("AGENT_NOTIFY_") &&
									key !== "ELECTRON_RUN_AS_NODE" &&
									key !== "CLAUDECODE"
							)
						),
						SS_QUEUE_SOURCE_DESKTOP: desktop,
						SS_QUEUE_CLAUDE_BIN: Bun.which("claude") ?? "",
						SS_QUEUE_CODEX_BIN: Bun.which("codex") ?? "",
						SS_QUEUE_NATIVE_CASES: process.env["SS_QUEUE_NATIVE_CASES"] ?? "",
						SHELL: "/bin/sh",
						SS_QUEUE_FIXTURE_ROOT: root,
						SS_QUEUE_MIGRATIONS: join(desktop, "src/main/db/migrations"),
					},
					stdio: ["ignore", "pipe", "pipe"],
				});
				let output = "";
				child.stdout?.on("data", (chunk) => {
					output = (output + String(chunk)).slice(-12000);
				});
				child.stderr?.on("data", (chunk) => {
					output = (output + String(chunk)).slice(-12000);
				});
				const timer = setTimeout(() => {
					child.kill("SIGKILL");
					reject(new Error(`Native queue timeout: ${output}`));
				}, 120000);
				child.once("error", (error) => {
					clearTimeout(timer);
					reject(error);
				});
				child.once("exit", (code) => {
					clearTimeout(timer);
					if (code !== 0) console.error(output);
					done(code);
				});
			});
			expect(code).toBe(0);
			expect(JSON.parse(readFileSync(join(root, "result.json"), "utf8")).passed).toBe(true);
		} finally {
			// Also remove the credential link when Electron crashes or the harness times out.
			rmSync(join(root, "codex-home/auth.json"), { force: true });
			if (keep) console.log(`Workspace queue fixture: ${root}`);
			else rmSync(root, { recursive: true, force: true });
		}
	},
	150000
);
