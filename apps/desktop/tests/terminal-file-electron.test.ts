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

test.skipIf(process.platform !== "darwin")(
	"real Electron inserts files between draft text and requires a separate Enter to submit",
	async () => {
		const root = realpathSync(mkdtempSync(join(tmpdir(), "ss-file-electron-")));
		const fixture = resolve(import.meta.dir, "fixtures/terminal-file-electron");
		try {
			mkdirSync(join(root, "profile"));
			mkdirSync(join(root, "node_modules"));
			symlinkSync(
				dirname(dirname(require.resolve("node-pty"))),
				join(root, "node_modules/node-pty")
			);
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
				join(root, "terminal-process-info"),
			]);
			symlinkSync(native, join(root, "sh"));
			for (const name of ["first file.pdf", "second's.mov", "雪.txt"])
				writeFileSync(join(root, name), "Disposable fixture");
			const plugin: Bun.BunPlugin = {
				name: "fixture-app-boundaries",
				setup(build) {
					build.onResolve({ filter: /^\.\.\/index$/ }, (args) =>
						args.importer.endsWith("/trpc/routers/terminal-files.ts")
							? { path: resolve(import.meta.dir, "../src/main/trpc/index.ts") }
							: undefined
					);
					build.onResolve({ filter: /^node-pty$/ }, () => ({
						path: require.resolve("node-pty"),
						external: true,
					}));
					build.onResolve(
						{
							filter:
								/(?:trpc\/client|stores\/tab-store|workspace-cwd-lookup|agent-session-manager-handle)$/,
						},
						(args) => ({ path: args.path, namespace: "fixture" })
					);
					build.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
						loader: "js",
						contents: args.path.endsWith("trpc/client")
							? "export const trpcVanilla = {terminalFiles: new Proxy({}, {get: (_, method) => ({mutate: input => window.electron.fixtureFiles(method,input), query: input => window.electron.fixtureFiles(method,input)})})};"
							: args.path.endsWith("stores/tab-store")
								? "export const useTabStore = {getState: () => ({updateTabTitle: () => {}})};"
								: args.path.endsWith("workspace-cwd-lookup")
									? "export const getWorkspaceCwdOrThrow = () => process.env.SS_FIXTURE_ROOT;"
									: "export const getAgentSessionManager = () => undefined;",
					}));
				},
			};
			for (const [entry, target, format, extension] of [
				["main.ts", "node", "cjs", ".cjs"],
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
					// Match electron-vite: native helpers live alongside the bundled main script.
					define: { __dirname: JSON.stringify(root) },
				});
				if (!build.success) throw new Error(build.logs.map(String).join("\n"));
			}
			writeFileSync(
				join(root, "index.html"),
				`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="./renderer.css"><style>html,body,#root{height:100%;margin:0}.xterm-container{height:400px}body{background:#111;color:white}</style><div id="root"></div><script type="module" src="./renderer.js"></script>`
			);
			const code = await new Promise<number | null>((done, reject) => {
				let diagnostics = "";
				const child = spawn(require("electron") as string, [join(root, "main.cjs")], {
					cwd: root,
					env: {
						PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
						SHELL: join(root, "sh"),
						SS_FIXTURE_ROOT: root,
						SS_FIXTURE_CAPTURE: join(root, "input"),
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
