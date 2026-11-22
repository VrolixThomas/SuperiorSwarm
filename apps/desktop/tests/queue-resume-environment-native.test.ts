import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
test.skipIf(process.platform !== "darwin")(
	"native environment snapshot preserves policy markers without exposing environment in ordinary identity probes",
	async () => {
		const root = mkdtempSync(join(tmpdir(), "queue-env-native-"));
		try {
			symlinkSync(resolve(import.meta.dir, "../node_modules"), join(root, "node_modules"));
			const helper = join(root, "terminal-process-info");
			const compiled = spawnSync(
				"cc",
				["-O2", join(import.meta.dir, "../src/daemon/terminal-process-info.c"), "-o", helper],
				{ encoding: "utf8" }
			);
			expect({ code: compiled.status, error: compiled.stderr }).toEqual({ code: 0, error: "" });
			const provider = join(root, "synthetic-provider");
			const source = join(root, "provider.c");
			writeFileSync(source, "#include <unistd.h>\nint main(void){for(;;)pause();}\n");
			const builtProvider = spawnSync("cc", [source, "-o", provider], { encoding: "utf8" });
			expect(builtProvider.status).toBe(0);
			const bundle = await Bun.build({
				entrypoints: [join(import.meta.dir, "fixtures/queue-environment-native/main.ts")],
				outdir: root,
				naming: "main.mjs",
				target: "node",
				format: "esm",
				external: ["node-pty"],
			});
			expect(bundle.success).toBe(true);
			const electronDir = dirname(require.resolve("electron/package.json"));
			const electron = join(
				electronDir,
				"dist",
				readFileSync(join(electronDir, "path.txt"), "utf8").trim()
			);
			const result = spawnSync(electron, [join(root, "main.mjs"), helper, provider], {
				cwd: root,
				env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
				encoding: "utf8",
				timeout: 15000,
			});
			expect({ code: result.status, error: result.stderr }).toEqual({ code: 0, error: "" });
			expect(result.stdout).toContain("PASS");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	}
);
