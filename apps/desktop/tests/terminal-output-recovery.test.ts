import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { shellIntegrationEnv } from "../src/daemon/shell-integration";

test("shell integration preserves environment and supports an explicit opt-out", async () => {
	const dir = await mkdtemp(join(tmpdir(), "ss-shell-env-"));
	try {
		const env = { ZDOTDIR: "/custom user/config", KEEP: "value" };
		const integrated = shellIntegrationEnv("/bin/zsh", env, dir);
		expect(integrated["ZDOTDIR"]).toStartWith(dir);
		expect(integrated["SUPERIORSWARM_ORIGINAL_ZDOTDIR"]).toBe(env.ZDOTDIR);
		expect(integrated["SUPERIORSWARM_ZDOTDIR_SET"]).toBe("1");
		expect(integrated["KEEP"]).toBe("value");
		expect(shellIntegrationEnv("/bin/zsh", integrated, dir)).toBe(integrated);
		expect(env.ZDOTDIR).toBe("/custom user/config");
		expect(shellIntegrationEnv("/bin/zsh", {}, dir)["SUPERIORSWARM_ZDOTDIR_SET"]).toBe("0");
		expect(shellIntegrationEnv("/bin/zsh", { ZDOTDIR: "" }, dir)["SUPERIORSWARM_ZDOTDIR_SET"]).toBe(
			"1"
		);
		for (const shell of ["/bin/bash", "/bin/sh", "/usr/local/bin/fish"]) {
			expect(shellIntegrationEnv(shell, env, dir)).toBe(env);
		}
		const disabled = { ...env, SUPERIORSWARM_SHELL_INTEGRATION: "0" };
		expect(shellIntegrationEnv("/bin/zsh", disabled, dir)).toBe(disabled);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("real zsh PTY recovers output after a TUI exits or is interrupted", async () => {
	const dir = await mkdtemp(join(tmpdir(), "ss-output-recovery-"));
	try {
		execFileSync("cc", [
			"-Wall",
			"-Wextra",
			"-Werror",
			resolve(import.meta.dir, "fixtures/terminal-output-mode.c"),
			"-o",
			join(dir, "tui"),
		]);
		const build = await Bun.build({
			entrypoints: [resolve(import.meta.dir, "fixtures/terminal-output-recovery.ts")],
			target: "node",
			format: "esm",
			external: ["node-pty"],
			outdir: dir,
			naming: "probe.mjs",
		});
		if (!build.success) throw Error(build.logs.join("\n"));
		await symlink(resolve(import.meta.dir, "../node_modules"), join(dir, "node_modules"));
		const child = Bun.spawn(["node", join(dir, "probe.mjs"), dir], {
			env: { ...process.env, SHELL: "/bin/zsh" },
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
			expect(stdout).toContain("verified baseline leak, shell recovery");
		} finally {
			clearTimeout(deadline);
			child.kill();
		}
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}, 20000);
