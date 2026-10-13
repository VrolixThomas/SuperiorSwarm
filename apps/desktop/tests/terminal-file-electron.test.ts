import { expect, test } from "bun:test";
import { execFileSync, spawn } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { resolveConfig } from "electron-vite";
import { type Plugin, build as viteBuild } from "vite";

test.skipIf(process.platform !== "darwin").each(["current", "legacy", "stale-current"])(
	"real Electron inserts dropped files through production tRPC with a %s daemon",
	async (daemonVersion) => {
		const root = realpathSync(mkdtempSync(join(tmpdir(), "ss-file-electron-")));
		const desktop = resolve(import.meta.dir, "..");
		const mainDir = join(root, "out/main");
		const fixture = resolve(import.meta.dir, "fixtures/terminal-file-electron");
		try {
			mkdirSync(join(root, "profile"));
			mkdirSync(mainDir, { recursive: true });
			symlinkSync(join(desktop, "node_modules"), join(root, "node_modules"));
			writeFileSync(join(root, "package.json"), '{"type":"module"}');
			const nativeDir = join(root, ".local/share/claude/versions");
			mkdirSync(nativeDir, { recursive: true });
			const native = join(nativeDir, "2.1.288");
			execFileSync("cc", ["-Wall", "-Wextra", "-Werror", join(fixture, "tui.c"), "-o", native]);
			execFileSync("cc", [
				"-Wall",
				"-Wextra",
				"-Werror",
				resolve(import.meta.dir, "../src/daemon/terminal-process-info.c"),
				"-o",
				join(mainDir, "terminal-process-info"),
			]);
			symlinkSync(native, join(root, "sh"));
			for (const name of ["first file.pdf", "second's.mov", "雪.txt"])
				writeFileSync(join(root, name), "Disposable fixture");
			const boundaries: Plugin = {
				name: "fixture-main-boundaries",
				enforce: "pre",
				resolveId(source) {
					if (/(?:workspace-cwd-lookup|agent-session-manager-handle|logger)$/.test(source))
						return `\0fixture:${source}`;
				},
				load(id) {
					if (!id.startsWith("\0fixture:")) return;
					return id.endsWith("logger")
						? "export const log = {info(){}, error(){}, warn(){}};"
						: id.endsWith("workspace-cwd-lookup")
							? "export const getWorkspaceCwdOrThrow = () => process.env.SS_FIXTURE_ROOT;"
							: "export const getAgentSessionManager = () => undefined;";
				},
			};
			const resolved = await resolveConfig(
				{ root: desktop, configFile: join(desktop, "electron.vite.config.ts"), logLevel: "silent" },
				"build"
			);
			const main = resolved.config?.main;
			if (!main) throw new Error("Missing production main build configuration");
			await viteBuild({
				...main,
				plugins: [
					...(main.plugins ?? []).filter(
						(plugin) =>
							!(
								plugin &&
								typeof plugin === "object" &&
								"name" in plugin &&
								["copy-drizzle-migrations", "terminal-file-helper"].includes(String(plugin.name))
							)
					),
					boundaries,
				],
				build: {
					...main.build,
					outDir: mainDir,
					emptyOutDir: false,
					rollupOptions: {
						...main.build?.rollupOptions,
						// Both entrypoints must share code, just as the release does. A
						// single Bun bundle with a forced __dirname hid helper lookup failures.
						input: {
							main: join(fixture, "main.ts"),
							daemon: join(desktop, "src/daemon/index.ts"),
						},
					},
				},
			});
			const plugin: Bun.BunPlugin = {
				name: "fixture-app-boundaries",
				setup(build) {
					build.onResolve({ filter: /stores\/tab-store$/ }, (args) => ({
						path: args.path,
						namespace: "fixture",
					}));
					build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
						loader: "js",
						contents: "export const useTabStore = {getState: () => ({updateTabTitle: () => {}})};",
					}));
				},
			};
			for (const [entry, target, format, extension] of [
				["preload.ts", "browser", "cjs", ".cjs"],
				["renderer.tsx", "browser", "esm", ".[ext]"],
			] as const) {
				const build = await Bun.build({
					entrypoints: [join(fixture, entry)],
					outdir: root,
					target,
					format,
					naming: `[name]${extension}`,
					external: ["electron"],
					plugins: [plugin],
				});
				if (!build.success) throw new Error(build.logs.map(String).join("\n"));
			}
			writeFileSync(
				join(root, "index.html"),
				`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="./renderer.css"><style>html,body,#root{height:100%;margin:0}.xterm-container{height:400px}body{background:#111;color:white}</style><div id="root"></div><script type="module" src="./renderer.js"></script>`
			);
			const code = await new Promise<number | null>((done, reject) => {
				let diagnostics = "";
				const electronDir = dirname(require.resolve("electron/package.json"));
				const electronPath = join(
					process.env["ELECTRON_OVERRIDE_DIST_PATH"] || join(electronDir, "dist"),
					readFileSync(join(electronDir, "path.txt"), "utf8").trim()
				);
				const child = spawn(electronPath, [join(mainDir, "main.js")], {
					cwd: root,
					env: {
						PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
						SHELL: join(root, "sh"),
						SS_FIXTURE_ROOT: root,
						SS_FIXTURE_CAPTURE: join(root, "input"),
						SS_FIXTURE_DAEMON: daemonVersion,
					},
					stdio: ["ignore", "pipe", "pipe"],
				});
				child.stdout?.on("data", (chunk) => {
					diagnostics = (diagnostics + chunk.toString()).slice(-8192);
				});
				child.stderr?.on("data", (chunk) => {
					diagnostics = (diagnostics + chunk.toString()).slice(-8192);
				});
				const timer = setTimeout(() => {
					child.kill("SIGKILL");
					reject(new Error(`Isolated Electron fixture timed out: ${diagnostics}`));
				}, 20000);
				child.once("error", (error) => {
					clearTimeout(timer);
					reject(error);
				});
				child.once("exit", (code) => {
					clearTimeout(timer);
					if (code !== 0 && diagnostics) console.error(diagnostics);
					done(code);
				});
			});
			const result = JSON.parse(readFileSync(join(root, "result.json"), "utf8"));
			expect(result).toEqual({
				supported: true,
				nativeFiles: 3,
				zeroBytesOnSelection: true,
				exactOrderedPaste: true,
				explicitEnter: true,
				twoStepEnter: true,
				interleavedDraft: true,
			});
			expect(code).toBe(0);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	},
	30000
);
