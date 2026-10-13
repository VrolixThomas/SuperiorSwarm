import { expect, test } from "bun:test";

// Module doubles must not contaminate neighboring Electron/DB tests.
for (const fixture of ["lifecycle.ts", "renderer.tsx", "locked-mac.ts"]) {
	test(`updater ${fixture} (isolated)`, async () => {
		const child = Bun.spawn(
			[process.execPath, "--no-env-file", "test", `./tests/fixtures/updater/${fixture}`],
			{ cwd: `${import.meta.dir}/..`, stdout: "pipe", stderr: "pipe" }
		);
		const [stdout, stderr, code] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]);
		if (code !== 0) throw new Error(`${stdout}\n${stderr}`);
		expect(code).toBe(0);
	}, 15000);
}
