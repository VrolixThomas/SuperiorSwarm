import { expect, test } from "bun:test";
import { resolve } from "node:path";

// Module mocks stay in a subprocess; this test cannot contaminate other renderer regressions.
test("jump/peek Open releases exact permission wait before navigation", async () => {
	const child = Bun.spawn(
		[process.execPath, "test", "./tests/fixtures/queue-jump-open/hook-case.tsx"],
		{
			cwd: resolve(import.meta.dir, ".."),
			stdout: "pipe",
			stderr: "pipe",
		}
	);
	const [code, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	expect({ code, output: code === 0 ? "passed" : stdout + stderr }).toEqual({
		code: 0,
		output: "passed",
	});
}, 10000);
