import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import * as pty from "node-pty";
import { PtyManager } from "../../src/daemon/pty-manager";
import { shellIntegrationEnv } from "../../src/daemon/shell-integration";

const root = process.argv[2];
assert(root);
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const manager = new PtyManager();
let legacy: pty.IPty | undefined;
const write = (id: string, data: string) => (legacy ? legacy.write(data) : manager.write(id, data));
let output = "";
async function until(predicate: () => boolean) {
	for (let i = 0; i < 500; i++) {
		if (predicate()) return;
		await delay(10);
	}
	throw Error(`Timed out waiting for isolated shell: ${JSON.stringify(output)}`);
}
async function command(id: string, value: string, status = 0) {
	output = "";
	write(id, `${value}\r`);
	await until(() => output.includes(`__PROMPT__${status}>`));
	return output;
}

try {
	for (const id of ["baseline", "recovery", "legacy"]) {
		const enabled = id !== "baseline";
		// Spaces and quotes in ZDOTDIR must be treated as data, not shell code.
		const config = join(root, `${id} user's config`);
		const redirected = join(config, "redirected");
		mkdirSync(redirected, { recursive: true });
		writeFileSync(join(config, ".zshenv"), `SS_STARTUP=env; export ZDOTDIR=${quote(redirected)}\n`);
		writeFileSync(join(redirected, ".zprofile"), "SS_STARTUP+=:profile\n");
		writeFileSync(
			join(redirected, ".zshrc"),
			`SS_STARTUP+=:rc
PROMPT='__PROMPT__%?> '
HISTFILE="$ZDOTDIR/history"
SAVEHIST=100
HISTSIZE=100
function user_prompt_hook() { SS_PROMPTS=$(( \${SS_PROMPTS:-0} + 1 )); }
precmd_functions+=(user_prompt_hook)
alias cy=${quote(quote(join(root, "tui")))}
`
		);
		writeFileSync(join(redirected, ".zlogin"), "SS_STARTUP+=:login\n");
		output = "";
		const env = {
			ZDOTDIR: config,
			SUPERIORSWARM_SHELL_INTEGRATION: enabled ? "1" : "0",
		};
		if (id === "legacy") {
			// Old daemons only merge the environment and spawn the shell. The
			// app's environment alone must install recovery without a restart.
			legacy = pty.spawn("/bin/zsh", ["-l"], {
				name: "xterm-256color",
				cols: 80,
				rows: 24,
				cwd: root,
				env: { ...process.env, ...shellIntegrationEnv("/bin/zsh", env, join(root, "integration")) },
			});
			legacy.onData((data) => {
				output += data;
			});
		} else
			manager.create(
				id,
				root,
				(data) => {
					output += data;
				},
				() => {},
				"client",
				env
			);
		await until(() => output.includes("__PROMPT__0>"));
		const startup = await command(id, 'print -r -- "$SS_STARTUP|$ZDOTDIR|$HISTFILE|$SS_PROMPTS"');
		assert(startup.includes(`env:profile:rc:login|${redirected}|${redirected}/history|1\r\n`));
		output = "";
		write(id, "cy\r");
		await until(() => output.includes("__RAW_READY__\nraw-two\n"));
		// A prompt hook must not change the foreground application's raw output.
		await delay(100);
		write(id, "x");
		await until(() => output.includes("__PROMPT__23>"));
		assert(output.includes("__RAW_UNCHANGED__\n"));
		const following = await command(id, "printf 'first\\nsecond\\n'");
		assert(following.includes(enabled ? "first\r\nsecond\r\n" : "first\nsecond\n"));
		if (enabled) {
			// Recovery survives later commands and preserves their exit status.
			const later = await command(id, "printf 'third\\nfourth\\n'; false", 1);
			assert(later.includes("third\r\nfourth\r\n"));
			output = "";
			write(id, "cy\r");
			await until(() => output.includes("__RAW_READY__\nraw-two\n"));
			write(id, "\x03");
			await until(() => output.includes("__PROMPT__130>"));
			const interrupted = await command(id, "printf 'after-interrupt\\nnext-line\\n'");
			assert(interrupted.includes("after-interrupt\r\nnext-line\r\n"));
			// A nested shell sees the real ZDOTDIR, never our temporary startup shim.
			const nested = await command(id, `/bin/zsh -c 'print -r -- "$ZDOTDIR"'`);
			assert(nested.includes(`${redirected}\r\n`));
		}
		manager.dispose(id);
	}
	console.log("verified baseline leak, shell recovery, raw TUI output, Ctrl-C, startup and status");
} finally {
	legacy?.kill("SIGKILL");
	manager.disposeAll();
}
