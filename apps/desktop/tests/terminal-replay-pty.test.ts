import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("real PTY preserves chat history across reattachment and flushes final output", async () => {
	const dir = await mkdtemp(join(tmpdir(), "ss-replay-pty-"));
	try {
		const build = await Bun.build({
			entrypoints: [resolve(import.meta.dir, "fixtures/terminal-replay-pty.ts")],
			target: "node",
			format: "esm",
			external: ["node-pty"],
			outdir: dir,
			naming: "probe.mjs",
		});
		if (!build.success) throw Error(build.logs.join("\n"));
		// Resolve the one native dependency next to the disposable bundle.
		await Bun.write(join(dir, "package.json"), '{"type":"module"}');
		const { symlink } = await import("node:fs/promises");
		await symlink(resolve(import.meta.dir, "../node_modules"), join(dir, "node_modules"));
		const child = Bun.spawn(["node", join(dir, "probe.mjs")], {
			env: { ...process.env, SHELL: "/bin/sh" },
			stdout: "pipe",
			stderr: "pipe",
		});
		const deadline = setTimeout(() => child.kill(), 15000);
		try {
			const [code, stdout, stderr] = await Promise.all([
				child.exited,
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
			]);
			if (code !== 0) throw Error(`${stdout}\n${stderr}`);
			expect(stdout).toContain(
				"history survived redraws, detach/attach, resize, live output and exit"
			);
		} finally {
			clearTimeout(deadline);
			child.kill();
		}
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}, 20000);
