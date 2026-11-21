import { expect, test } from "bun:test";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
test.skipIf(process.platform !== "darwin")(
	"full live-adapter ReviewWorkspace with native Monaco and production snapshot IPC",
	async () => {
		const root = mkdtempSync(join(tmpdir(), "ss-review-ui-"));
		const repo = join(root, "repo");
		mkdirSync(repo);
		mkdirSync(join(root, "profile"));
		const git = (...args: string[]) =>
			execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
		const write = (path: string, body: string | Buffer) => {
			mkdirSync(dirname(join(repo, path)), { recursive: true });
			writeFileSync(join(repo, path), body);
		};
		git("init", "-q");
		git("config", "user.name", "Validation");
		git("config", "user.email", "validation@example.invalid");
		write("src/alpha.ts", "// base alpha\nconst valid = false;\nexport const value = 0;\n// end\n");
		write("src/beta.ts", "// base beta\nconst value = 0;\nexport { value };\n");
		write("context.ts", "export const context = 'saved context';\n");
		write("unchanged.test.ts", "// unchanged test\nexport const test = true;\n");
		for (let i = 0; i < 102; i++)
			write(`many/file-${String(i).padStart(3, "0")}.ts`, `// base ${i}\n`);
		git("add", ".");
		git("commit", "-qm", "base");
		const base = git("rev-parse", "HEAD");
		write("src/alpha.ts", "// head alpha\nconst valid = true;\nexport const value = 1;\n// end\n");
		write("src/beta.ts", "// head beta\nconst value = 1;\nexport { value };\n");
		write("empty.txt", "");
		write("binary.dat", Buffer.from([0, 1, 2, 0, 3]));
		for (let i = 0; i < 102; i++)
			write(`many/file-${String(i).padStart(3, "0")}.ts`, `// head ${i}\n`);
		git("add", ".");
		git("commit", "-qm", "head");
		const head = git("rev-parse", "HEAD");
		const builder = Bun.spawn(
			[process.execPath, join(import.meta.dir, "fixtures/review-workspace-native/build.ts"), root],
			{ stdout: "pipe", stderr: "pipe" }
		);
		const [code, out, err] = await Promise.all([
			builder.exited,
			new Response(builder.stdout).text(),
			new Response(builder.stderr).text(),
		]);
		if (code !== 0) throw Error(out + err);
		const electronDir = dirname(require.resolve("electron/package.json"));
		const executable = join(
			electronDir,
			"dist",
			readFileSync(join(electronDir, "path.txt"), "utf8").trim()
		);
		await new Promise<void>((done, reject) => {
			const child = spawn(executable, [join(root, "main.mjs")], {
				cwd: root,
				env: {
					PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
					SS_UI_ROOT: root,
					SS_UI_BASE: base,
					SS_UI_HEAD: head,
				},
				stdio: ["ignore", "pipe", "pipe"],
			});
			let output = "";
			const collect = (chunk: Buffer) => {
				output = (output + chunk.toString()).slice(-16000);
			};
			child.stdout.on("data", collect);
			child.stderr.on("data", collect);
			const timer = setTimeout(() => {
				child.kill("SIGKILL");
				reject(Error(`Timeout ${root}: ${output}`));
			}, 100000);
			child.once("error", reject);
			child.once("exit", (code) => {
				clearTimeout(timer);
				writeFileSync(join(root, "electron.log"), output);
				code === 0 ? done() : reject(Error(`${root}: ${output}`));
			});
		});
		const report = JSON.parse(readFileSync(join(root, "result.json"), "utf8"));
		console.log(`Native evidence: ${root}`);
		console.log(JSON.stringify(report.result, null, 2));
		expect(report.result.fatal).toBeUndefined();
		expect(report.forbidden).toEqual([]);
		expect(report.result.results.filter((r: any) => !r.pass)).toEqual([]);
		if (process.env["SS_KEEP_UI_ARTIFACTS"] !== "1") rmSync(root, { recursive: true, force: true });
	},
	120000
);
