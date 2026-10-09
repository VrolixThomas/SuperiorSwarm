import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

test("pinned xterm in isolated Electron: propagation, modes, bytes, focus and lifecycle", async () => {
	expect(require("@xterm/xterm/package.json").version).toBe("6.0.0");
	const dir = await mkdtemp(join(tmpdir(), "ss-wheel-electron-"));
	let child: Bun.Subprocess<"ignore", "pipe", "pipe"> | undefined;
	try {
		const build = await Bun.build({
			entrypoints: [resolve(import.meta.dir, "fixtures/terminal-wheel-browser.ts")],
			outdir: dir,
			target: "browser",
			naming: "wheel.js",
		});
		if (!build.success) throw Error(build.logs.join("\n"));
		const css = pathToFileURL(require.resolve("@xterm/xterm/css/xterm.css")).href;
		await writeFile(
			join(dir, "index.html"),
			`<!doctype html><html><head><link rel="stylesheet" href="${css}"></head><body><script src="wheel.js"></script></body></html>`
		);
		const env = { ...process.env };
		// biome-ignore lint/performance/noDelete: Electron requires absence.
		delete env["ELECTRON_RUN_AS_NODE"];
		// The desktop preload mocks require("electron"); use its installed path metadata.
		const electronDir = dirname(require.resolve("electron/package.json"));
		const executable = (await readFile(join(electronDir, "path.txt"), "utf8")).trim();
		const electronPath = join(
			env["ELECTRON_OVERRIDE_DIST_PATH"] || join(electronDir, "dist"),
			executable
		);
		child = Bun.spawn(
			[electronPath, resolve(import.meta.dir, "fixtures/terminal-wheel-electron.cjs"), dir],
			{ env, stdin: "ignore", stdout: "pipe", stderr: "pipe" }
		);
		const timer = setTimeout(() => child?.kill(), 25000);
		try {
			const [code, stdout, stderr] = await Promise.all([
				child.exited,
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
			]);
			if (code !== 0) throw Error(`Electron exited ${code}\n${stdout}\n${stderr}`);
			const report = JSON.parse(stdout.trim().split("\n").at(-1) ?? "{}");
			expect(report.results).toHaveLength(7);
			console.log(
				`xterm 6.0.0; Electron ${report.versions.electron}; Chromium ${report.versions.chrome}: ${report.results.join("; ")}`
			);
		} finally {
			clearTimeout(timer);
		}
	} finally {
		if (child) {
			child.kill();
			await child.exited;
		}
		await rm(dir, { recursive: true, force: true });
	}
}, 30000);
