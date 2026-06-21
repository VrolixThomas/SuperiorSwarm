import { execFile } from "node:child_process";

const FOUND_MARKER = "__SS_CLI_FOUND__";

/**
 * Probe whether a CLI is on the user's PATH.
 *
 * Uses the user's actual login shell ($SHELL) with `-lic` (login + interactive)
 * so PATH entries set in ~/.zshrc — the macOS default shell, and where most
 * tools add themselves — are honored. A hardcoded `bash -lc` misses zsh-only
 * PATH and would report Claude Code as "not installed" even when it is, which
 * left fresh installs with no MCP registered.
 *
 * Robust against noisy rc files: we don't parse PATH output, we just look for a
 * sentinel echoed only when `command -v` succeeds, so banners/warnings printed
 * by the rc file can't produce a false positive.
 */
export function probeCliInPath(cmd: string): Promise<boolean> {
	const shell = process.env.SHELL || "/bin/bash";
	return new Promise((resolve) => {
		execFile(
			shell,
			["-lic", `command -v ${cmd} >/dev/null 2>&1 && echo ${FOUND_MARKER}`],
			{ timeout: 5000 },
			(_err, stdout) => {
				resolve(stdout.includes(FOUND_MARKER));
			}
		);
	});
}
