import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { snapshotFixture } from "./helpers/review-snapshot-fixture";

test.skipIf(process.platform !== "darwin")(
	"pr-reading-lifecycle: native renderer, registered router, runtime, MCP and terminal attachment",
	async () => {
		const fixture = snapshotFixture();
		const root = fixture.directory;
		try {
			fixture.git("update-ref", "refs/heads/change", fixture.base);
			fixture.write("new.txt", "mutable sentinel");
			mkdirSync(join(root, "profile"));
			symlinkSync(join(import.meta.dir, "../node_modules"), join(root, "node_modules"));
			cpSync(join(import.meta.dir, "../src/main/db/migrations"), join(root, "db/migrations"), {
				recursive: true,
			});
			mkdirSync(join(root, "bin"));
			writeFileSync(join(root, "bin/shell"), "#!/bin/sh\nexec /bin/sh\n", { mode: 0o700 });
			writeFileSync(
				join(root, "bin/codex"),
				"#!/bin/sh\nprintf 'DISPOSABLE_CLI_READY\\n'\nwhile read line; do [ \"$line\" = exit ] && exit 7; done\n",
				{ mode: 0o700 }
			);
			fixture.write("a.ts", "export const a=1;\n");
			fixture.write("b.test.ts", "test();\n");
			fixture.git("add", ".");
			fixture.git("commit", "-m", "native lifecycle fixture");
			const firstHead = fixture.git("rev-parse", "HEAD");
			fixture.write("a.ts", "export const a=2;\n");
			const secondHead = fixture.commit();
			fixture.write("a.ts", "export const a=3;\n");
			const thirdHead = fixture.commit();
			// Separate process avoids Bun test-runner bundler cache aliasing on macOS.
			const builder = Bun.spawn(
				[process.execPath, join(import.meta.dir, "fixtures/pr-reading-lifecycle/build.ts"), root],
				{ stdout: "pipe", stderr: "pipe" }
			);
			const [buildCode, stdout, stderr] = await Promise.all([
				builder.exited,
				new Response(builder.stdout).text(),
				new Response(builder.stderr).text(),
			]);
			if (buildCode !== 0) throw new Error(stdout + stderr);

			writeFileSync(
				join(root, "index.html"),
				'<!doctype html><meta charset="utf-8"><div id="root"></div><script type="module" src="./renderer.js"></script>'
			);
			const electronDir = dirname(require.resolve("electron/package.json"));
			const executable = join(
				process.env["ELECTRON_OVERRIDE_DIST_PATH"] || join(electronDir, "dist"),
				readFileSync(join(electronDir, "path.txt"), "utf8").trim()
			);
			await new Promise<void>((resolve, reject) => {
				let diagnostics = "";
				const child = spawn(executable, [join(root, "main.cjs")], {
					cwd: root,
					env: {
						PATH: `${join(root, "bin")}:/usr/bin:/bin:/usr/sbin:/sbin`,
						SHELL: join(root, "bin/shell"),
						SUPERIORSWARM_SHELL_INTEGRATION: "0",
						SUPABASE_URL: "http://127.0.0.1:9",
						SUPABASE_ANON_KEY: "disposable-fixture-only",
						SS_LIFECYCLE_ROOT: root,
						SS_LIFECYCLE_HEAD: firstHead,
						SS_LIFECYCLE_SECOND: secondHead,
						SS_LIFECYCLE_THIRD: thirdHead,
					},
					stdio: ["ignore", "pipe", "pipe"],
				});
				child.stdout.on("data", (chunk) => {
					diagnostics = (diagnostics + chunk.toString()).slice(-8192);
				});
				child.stderr.on("data", (chunk) => {
					diagnostics = (diagnostics + chunk.toString()).slice(-8192);
				});
				const timer = setTimeout(() => {
					child.kill("SIGKILL");
					reject(new Error(`Isolated snapshot fixture timed out: ${diagnostics}`));
				}, 35000);
				child.once("error", (error) => {
					clearTimeout(timer);
					reject(error);
				});
				child.once("exit", (code) => {
					clearTimeout(timer);
					if (code === 0) resolve();
					else reject(new Error(`Electron exited ${code}: ${diagnostics}`));
				});
			});
			const result = JSON.parse(readFileSync(join(root, "result.json"), "utf8"));
			mkdirSync("/tmp/pr-reading-lifecycle-validation", { recursive: true });
			writeFileSync(
				"/tmp/pr-reading-lifecycle-validation/native-result.json",
				JSON.stringify(result, null, 2)
			);
			expect(result.result.error).toBeUndefined();
			expect(result.result.checks.filter((check: { passed: boolean }) => !check.passed)).toEqual(
				[]
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	},
	45000
);
