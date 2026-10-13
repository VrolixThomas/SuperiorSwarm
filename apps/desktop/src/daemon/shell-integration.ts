import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { SUPERIORSWARM_DIR } from "../shared/daemon-protocol";

// Restore ZDOTDIR before sourcing the user's .zshenv so all subsequent startup
// files, history paths and nested shells use the user's normal configuration.
// Only output newline processing is repaired: raw input, echo, mouse reporting
// and the running application's output remain owned by the application.
const ZSH_ENV = `
if [[ \${SUPERIORSWARM_ZDOTDIR_SET-} == 1 ]]; then
	export ZDOTDIR="$SUPERIORSWARM_ORIGINAL_ZDOTDIR"
else
	unset ZDOTDIR
fi
unset SUPERIORSWARM_ZDOTDIR_SET SUPERIORSWARM_ORIGINAL_ZDOTDIR
if [[ -r \${ZDOTDIR-$HOME}/.zshenv ]]; then
	source "\${ZDOTDIR-$HOME}/.zshenv"
fi
if [[ -o interactive ]]; then
	function __superiorswarm_restore_output() {
		# zsh adopts a child's tty settings on exit. Repair them in the shell;
		# changing the PTY externally during ZLE is undone by the next command.
		command stty opost onlcr < /dev/tty 2>/dev/null
		# A failed hook must not suppress the user's remaining prompt hooks.
		return 0
	}
	typeset -ga precmd_functions
	precmd_functions+=(__superiorswarm_restore_output)
fi
`;

export function shellIntegrationEnv(
	shell: string,
	env: Record<string, string>,
	root = join(SUPERIORSWARM_DIR, "shell-integration")
): Record<string, string> {
	if (basename(shell) !== "zsh" || env["SUPERIORSWARM_SHELL_INTEGRATION"] === "0") return env;
	// The app also prepares this environment so new terminals on an older,
	// still-running daemon get recovery. Do not wrap that startup shim twice.
	if (env["SUPERIORSWARM_ZDOTDIR_SET"] !== undefined) return env;
	// Content-addressed startup files remain valid for shells starting during an
	// app update. No user dotfiles are modified and no input is sent to a prompt.
	const version = createHash("sha256").update(ZSH_ENV).digest("hex").slice(0, 12);
	const directory = join(root, `zsh-${version}`);
	try {
		mkdirSync(directory, { recursive: true, mode: 0o700 });
		try {
			writeFileSync(join(directory, ".zshenv"), ZSH_ENV, { flag: "wx", mode: 0o600 });
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		}
	} catch (error) {
		console.warn("[terminal] Unable to install shell output recovery:", error);
		return env;
	}
	return {
		...env,
		SUPERIORSWARM_ZDOTDIR_SET: env["ZDOTDIR"] === undefined ? "0" : "1",
		SUPERIORSWARM_ORIGINAL_ZDOTDIR: env["ZDOTDIR"] ?? "",
		ZDOTDIR: directory,
	};
}
