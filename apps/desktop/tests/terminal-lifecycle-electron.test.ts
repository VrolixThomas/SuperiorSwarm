import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

for (const legacy of [false, true]) {
	test(
		`actual Terminal component, IPC, socket and PTY survive navigation (${legacy ? "legacy" : "snapshot"} daemon)`,
		async () => {
			const root = mkdtempSync(join(tmpdir(), "ss-lifecycle-"));
			const desktop = resolve(import.meta.dir, "..");
			const fixture = join(import.meta.dir, "fixtures/terminal-lifecycle");
			try {
				symlinkSync(join(desktop, "node_modules"), join(root, "node_modules"));
				cpSync(join(desktop, "src/main/db/migrations"), join(root, "db/migrations"), {
					recursive: true,
				});
				cpSync(join(fixture, "tui.py"), join(root, "tui.py"));
				for (const [entry, target, format, naming] of [
					[join(fixture, "main.ts"), "node", "cjs", "main.cjs"],
					[join(desktop, "src/preload/index.ts"), "browser", "cjs", "preload.cjs"],
					[join(fixture, "renderer.tsx"), "browser", "esm", "renderer.[ext]"],
				] as const) {
					const config = {
						entrypoints: [entry],
						outdir: root,
						target,
						format,
						naming,
						external: ["electron", "node-pty", "better-sqlite3"],
						define: { __dirname: JSON.stringify(root) },
					};
					// Isolate Bun's bundler cache between fixture builds (reused builds
					// can read the wrong file under the test runner on macOS).
					const builder = Bun.spawn(
						[
							process.execPath,
							"-e",
							`const r=await Bun.build(${JSON.stringify(config)});if(!r.success){console.error(r.logs);process.exit(1)}`,
						],
						{ stdout: "pipe", stderr: "pipe" }
					);
					const [code, stdout, stderr] = await Promise.all([
						builder.exited,
						new Response(builder.stdout).text(),
						new Response(builder.stderr).text(),
					]);
					if (code !== 0) throw Error(stdout + stderr);
				}
				writeFileSync(
					join(root, "index.html"),
					'<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="renderer.css"><style>html,body,#root{height:100%;margin:0}.xterm-container{height:560px}body{background:#111;color:white}</style><div id="root"></div><script type="module" src="renderer.js"></script>'
				);
				const electronDir = dirname(require.resolve("electron/package.json"));
				const electron = join(
					electronDir,
					"dist",
					readFileSync(join(electronDir, "path.txt"), "utf8").trim()
				);
				const soak = Number(process.env["SS_SOAK_MS"] || 0);
				await new Promise<void>((done, reject) => {
					let output = "";
					const child = spawn(electron, [join(root, "main.cjs")], {
						cwd: root,
						env: {
							PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
							SHELL: "/bin/sh",
							SS_FIXTURE_ROOT: root,
							SS_LEGACY: legacy ? "1" : "0",
							SS_SOAK_MS: String(soak),
							SS_SOAK_PROGRESS: process.env["SS_SOAK_PROGRESS"],
						},
						stdio: ["ignore", "pipe", "pipe"],
					});
					const capture = (s: Buffer) => {
						output = (output + s.toString()).slice(-12000);
					};
					child.stdout.on("data", capture);
					child.stderr.on("data", capture);
					const timer = setTimeout(() => {
						child.kill("SIGKILL");
						reject(Error(`Lifecycle timeout: ${output}`));
					}, 60000 + soak);
					child.once("error", (e) => {
						clearTimeout(timer);
						reject(e);
					});
					child.once("exit", (code) => {
						clearTimeout(timer);
						if (code === 0) done();
						else reject(Error(output));
					});
				});
				const report = JSON.parse(readFileSync(join(root, "result.json"), "utf8"));
				expect(report).toMatchObject({
					legacy,
					cycles: 100,
					reconnect: true,
					wheelReports: 2,
					typing: true,
				});
				console.log(JSON.stringify(report));
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		},
		70000 + Number(process.env["SS_SOAK_MS"] || 0)
	);
}
