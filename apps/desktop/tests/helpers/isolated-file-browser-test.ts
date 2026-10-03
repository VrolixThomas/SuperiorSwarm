import { test } from "bun:test";

/** Keep Electron/Monaco module doubles out of neighboring test files. */
export function inIsolatedFileBrowserTest(path: string, label: string): boolean {
	if (process.env["FILE_BROWSER_TEST_CHILD"] === path) return true;
	test(label, async () => {
		const child = Bun.spawn([process.execPath, "--no-env-file", "test", path], {
			cwd: `${import.meta.dir}/../..`,
			env: { ...process.env, FILE_BROWSER_TEST_CHILD: path },
			stdout: "pipe",
			stderr: "pipe",
		});
		const [stdout, stderr, code] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]);
		if (code !== 0) throw new Error(`${stdout}\n${stderr}`);
	}, 15000);
	return false;
}
