import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("browser acceptance in the full App renderer with real pane/sidebar/dialog components", async () => {
	const child = Bun.spawn(
		[process.execPath, "test", resolve(import.meta.dir, "workspace-browser-electron.test.ts")],
		{
			cwd: resolve(import.meta.dir, ".."),
			env: { ...process.env, BROWSER_APP_SHELL: "1" },
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
		}
	);
	const timeout = setTimeout(() => child.kill(), 85000);
	try {
		const [status, stdout, stderr] = await Promise.all([
			child.exited,
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
		]);
		if (status !== 0)
			throw new Error(`Full application browser acceptance failed\n${stdout}\n${stderr}`);
		expect(stdout).toContain(
			"actual App renderer with sidebar, workspace, terminals and browser tab"
		);
		expect(stdout).toContain("actual split layout preserves the same guest");
	} finally {
		clearTimeout(timeout);
		child.kill();
	}
}, 90000);
