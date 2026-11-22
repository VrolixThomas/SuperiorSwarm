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
test.skipIf(process.platform !== "darwin")(
	"mixed workspace, ticket, PR and hook attention shares one native queue",
	async () => {
		const desktop = resolve(import.meta.dir, "..");
		const fixture = join(desktop, "tests/fixtures/combined-queue-electron");
		const root = realpathSync(mkdtempSync(join(tmpdir(), "ss-combined-")));
		const keep = process.env["SS_KEEP_QUEUE_FIXTURE"] === "1";
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
				define: {
					...main.define,
					"process.env.SUPABASE_URL": JSON.stringify("http://127.0.0.1:1"),
					"process.env.SUPABASE_ANON_KEY": JSON.stringify("synthetic-fixture"),
				},
				plugins: (main.plugins ?? []).filter(
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
					outDir: join(root, "main"),
					rollupOptions: {
						...main.build?.rollupOptions,
						input: { main: join(fixture, "main.ts") },
					},
				},
			});
			const renderer = Bun.spawnSync([
				process.execPath,
				"build",
				join(fixture, "renderer.tsx"),
				"--target",
				"browser",
				"--outfile",
				join(root, "renderer.js"),
			]);
			if (renderer.exitCode !== 0) throw new Error(renderer.stderr.toString());
			writeFileSync(
				join(root, "index.html"),
				'<!doctype html><html data-theme="dark"><head><meta charset="utf-8"><link rel="stylesheet" href="./index.css"></head><body style="background:#171717;color:#eee"><div id="root"></div><script type="module" src="./renderer.js"></script></body></html>'
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
						PATH: "/usr/bin:/bin",
						HOME: root,
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
				}, 60000);
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
			expect(JSON.parse(readFileSync(join(root, "result.json"), "utf8"))).toMatchObject({
				mixedSources: 8,
				counts: true,
				receipts: true,
				navigation: true,
				peek: true,
				noNetwork: true,
				noShellReplacement: true,
			});
		} finally {
			if (keep) console.log(`Combined queue fixture: ${root}`);
			else rmSync(root, { recursive: true, force: true });
		}
	},
	120000
);
