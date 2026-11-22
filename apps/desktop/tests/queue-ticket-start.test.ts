import { expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";

// Isolate router module mocks from unrelated source/provider tests in this Bun process.
test("confirmed ticket Start reserves and links one occurrence across races and restart", async () => {
	const child = Bun.spawn(
		[
			process.execPath,
			"--preload",
			join(import.meta.dir, "preload-electron-mock.ts"),
			join(import.meta.dir, "fixtures/queue-ticket-start/case.ts"),
		],
		{
			cwd: join(import.meta.dir, ".."),
			stdout: "pipe",
			stderr: "pipe",
		}
	);
	const timer = setTimeout(() => child.kill(), 15000);
	try {
		const [code, stdout, stderr] = await Promise.all([
			child.exited,
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
		]);
		expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
		expect(stdout.match(/PASS:/g)).toHaveLength(6);
	} finally {
		clearTimeout(timer);
		rmSync(`/tmp/superiorswarm-test-${child.pid}`, { recursive: true, force: true });
	}
}, 20000);
