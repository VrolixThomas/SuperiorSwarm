import { expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("concurrent own-chat mount and explicit create retain one PTY and its callback identity", async () => {
	const directory = realpathSync(mkdtempSync(join(tmpdir(), "owned-chat-ipc-")));
	const child = Bun.spawn(
		[
			process.execPath,
			"--preload",
			join(import.meta.dir, "preload-electron-mock.ts"),
			join(import.meta.dir, "fixtures/owned-chat/terminal-create-case.ts"),
		],
		{
			cwd: join(import.meta.dir, ".."),
			env: { ...process.env, SS_OWNED_CHAT_FIXTURE_ROOT: directory },
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
		expect(stdout).toContain("PASS: concurrent mount and explicit create");
	} finally {
		clearTimeout(timer);
		rmSync(directory, { recursive: true, force: true });
	}
}, 20000);
