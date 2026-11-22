import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import tailwindcss from "@tailwindcss/postcss";
import postcss from "postcss";

test(
	"workspace browser in real Electron: IPC, native view, React controls and lifecycle",
	async () => {
		const directory = await mkdtemp(join(tmpdir(), "ss-workspace-browser-"));
		let child: Bun.Subprocess<"ignore", "pipe", "pipe"> | undefined;
		try {
			for (const [entry, naming, target] of [
				["fixtures/workspace-browser-main.ts", "workspace-browser-main.cjs", "node"],
				["../src/preload/index.ts", "preload.cjs", "node"],
				[
					process.env["BROWSER_APP_SHELL"]
						? "fixtures/workspace-browser-app-renderer.tsx"
						: "fixtures/workspace-browser-renderer.tsx",
					"renderer.js",
					"browser",
				],
			] as const) {
				// A separate bundler process avoids bun:test's module mocks affecting resolution.
				if (target === "browser" && process.env["BROWSER_APP_SHELL"]) {
					const appBuild = Bun.spawn(
						[
							process.execPath,
							resolve(import.meta.dir, "fixtures/build-browser-app.mjs"),
							directory,
						],
						{
							env: {
								...process.env,
								NODE_ENV: process.env["BROWSER_TEST_REACT_MODE"] ?? "production",
							},
							stdout: "pipe",
							stderr: "pipe",
						}
					);
					const [code, output, errors] = await Promise.all([
						appBuild.exited,
						new Response(appBuild.stdout).text(),
						new Response(appBuild.stderr).text(),
					]);
					if (code !== 0) throw Error(output + errors);
					continue;
				}
				const build = Bun.spawn(
					[
						process.execPath,
						"build",
						resolve(import.meta.dir, entry),
						`--outfile=${join(directory, naming)}`,
						`--target=${target}`,
						`--format=${target === "node" ? "cjs" : "esm"}`,
						"--external=electron",
						`--define=process.env.NODE_ENV="${process.env["BROWSER_TEST_REACT_MODE"] ?? "production"}"`,
					],
					{ stdout: "pipe", stderr: "pipe" }
				);
				const [code, stderr] = await Promise.all([build.exited, new Response(build.stderr).text()]);
				if (code !== 0) throw Error(stderr);
			}
			// Compile the real app stylesheet: hand-written fixture CSS missed app chrome collisions.
			const stylesheet = resolve(import.meta.dir, "../src/renderer/styles.css");
			const css = await postcss([tailwindcss()]).process(await readFile(stylesheet, "utf8"), {
				from: stylesheet,
			});
			await writeFile(join(directory, "app.css"), css.css);
			await writeFile(
				join(directory, "index.html"),
				`<!doctype html><html><head><link rel="stylesheet" href="app.css"></head><body><div id="root"></div><script type="module" src="renderer.js"></script></body></html>`
			);
			const env = { ...process.env };
			// biome-ignore lint/performance/noDelete: Electron requires the variable to be absent.
			delete env["ELECTRON_RUN_AS_NODE"];
			const electronDir = dirname(require.resolve("electron/package.json"));
			const executable = (await readFile(join(electronDir, "path.txt"), "utf8")).trim();
			const electron = join(
				env["ELECTRON_OVERRIDE_DIST_PATH"] || join(electronDir, "dist"),
				executable
			);
			if (process.env["BROWSER_SMOKE_URL"]) console.log(`Browser fixture running: ${directory}`);
			child = Bun.spawn(
				[electron, resolve(import.meta.dir, "fixtures/workspace-browser-electron.cjs"), directory],
				{ env, stdin: "ignore", stdout: "pipe", stderr: "pipe" }
			);
			const timeout = setTimeout(
				() => child?.kill(),
				process.env["BROWSER_SMOKE_URL"] ? 85000 : 45000
			);
			try {
				const [code, stdout, stderr] = await Promise.all([
					child.exited,
					new Response(child.stdout).text(),
					new Response(child.stderr).text(),
				]);
				await writeFile(join(directory, "stdout.log"), stdout);
				await writeFile(join(directory, "stderr.log"), stderr);
				if (code !== 0)
					throw Error(`Electron exited ${code}\n${stdout}\n${stderr}\nFixture: ${directory}`);
				const reportLine = stdout
					.split("\n")
					.reverse()
					.find((line) => line.startsWith('{"checks":'));
				if (!reportLine) throw Error(`No native completion report\n${stdout}\n${stderr}`);
				const report = JSON.parse(reportLine);
				expect(report.checks.length).toBeGreaterThanOrEqual(
					process.env["BROWSER_APP_SHELL"] ? 6 : 12
				);
				console.log(`Electron ${report.electron}: ${report.checks.join("; ")}`);
				if (!process.env["BROWSER_APP_SHELL"]) {
					const restart = Bun.spawn(
						[
							electron,
							resolve(import.meta.dir, "fixtures/workspace-browser-electron.cjs"),
							directory,
							"restore",
						],
						{ env, stdin: "ignore", stdout: "pipe", stderr: "pipe" }
					);
					const restartTimer = setTimeout(() => restart.kill(), 45000);
					try {
						const [status, output, errors] = await Promise.all([
							restart.exited,
							new Response(restart.stdout).text(),
							new Response(restart.stderr).text(),
						]);
						if (status !== 0) throw new Error(`Browser restart failed: ${output}\n${errors}`);
						const line = output
							.split("\n")
							.reverse()
							.find((line) => line.startsWith('{"checks":'));
						const restarted = JSON.parse(line ?? "{}");
						expect(restarted.checks).toContain(
							"workspace profile persists across Electron restarts"
						);
						expect(restarted.checks).toContain("clear browsing data removes persistent storage");
					} finally {
						clearTimeout(restartTimer);
						restart.kill();
					}
				}
			} finally {
				clearTimeout(timeout);
			}
		} finally {
			if (child) {
				child.kill();
				await child.exited;
			}
			if (!process.env["KEEP_BROWSER_FIXTURE"])
				await rm(directory, { recursive: true, force: true });
			else console.log(`Browser fixture retained: ${directory}`);
		}
	},
	process.env["BROWSER_SMOKE_URL"] ? 90000 : 60000
);
