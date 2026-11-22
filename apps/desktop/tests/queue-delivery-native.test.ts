import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
test("native SQLite immediate admission excludes competing WAL writers before the PTY side effect", async () => {
	const root = mkdtempSync(join(tmpdir(), "queue-native-admission-"));
	try {
		symlinkSync(resolve(import.meta.dir, "../node_modules"), join(root, "node_modules"));
		const built = await Bun.build({
			entrypoints: [join(import.meta.dir, "fixtures/queue-delivery-native/main.ts")],
			outdir: root,
			naming: "main.mjs",
			target: "node",
			format: "esm",
			external: ["better-sqlite3"],
		});
		expect(built.success).toBe(true);
		const electronDir = dirname(require.resolve("electron/package.json"));
		const electron = join(
			electronDir,
			"dist",
			readFileSync(join(electronDir, "path.txt"), "utf8").trim()
		);
		const result = spawnSync(electron, [join(root, "main.mjs")], {
			cwd: root,
			env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
			encoding: "utf8",
			timeout: 15000,
		});
		expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: "" });
		expect(result.stdout).toContain("PASS");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
