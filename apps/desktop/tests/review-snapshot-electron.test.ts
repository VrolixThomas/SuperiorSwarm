import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { snapshotFixture } from "./helpers/review-snapshot-fixture";

test.skipIf(process.platform !== "darwin")(
	"isolated Electron renderer reads pinned snapshots through production preload transport and tRPC IPC",
	async () => {
		const fixture = snapshotFixture();
		const root = fixture.directory;
		try {
			fixture.git("update-ref", "refs/heads/change", fixture.base);
			fixture.write("new.txt", "mutable sentinel");
			mkdirSync(join(root, "profile"));
			// Separate process avoids Bun test-runner bundler cache aliasing on macOS.
			const builder = Bun.spawn(
				[
					process.execPath,
					join(import.meta.dir, "fixtures/review-snapshot-electron/build.ts"),
					root,
				],
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
				const child = spawn(executable, [join(root, "main.mjs")], {
					cwd: root,
					env: {
						PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
						SS_SNAPSHOT_FIXTURE: root,
						SS_SNAPSHOT_HEAD: fixture.head,
						SS_SNAPSHOT_BASE: fixture.target,
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
				}, 20000);
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
			const result = JSON.parse(readFileSync(join(root, "result.json"), "utf8")) as {
				result: unknown;
				calls: { path: string; type: string }[];
			};
			expect(result.result).toEqual({
				immutableChanged: true,
				emptyContext: true,
				missingContext: true,
				unknownRevision: true,
			});
			expect(result.calls.length).toBeGreaterThan(0);
			expect(
				result.calls.every(
					(call) => call.type === "query" && call.path.startsWith("reviewExplanation.")
				)
			).toBe(true);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	},
	30000
);
