import { execFile } from "node:child_process";

export class GitReadError extends Error {
	constructor(readonly reason: "cancelled" | "limit" | "failed") {
		super("Unable to read local Git objects");
	}
}

/** Do not inherit GIT_DIR, config injection, SSH commands, external diffs or credentials. */
export function readGit(root: string, args: string[], signal: AbortSignal): Promise<Buffer> {
	if (signal.aborted) return Promise.reject(new GitReadError("cancelled"));
	return new Promise((resolve, reject) => {
		execFile(
			"git",
			[
				"--no-pager",
				"-c",
				"core.fsmonitor=false",
				"-c",
				"core.hooksPath=/dev/null",
				"-c",
				"core.attributesFile=/dev/null",
				"-c",
				"credential.helper=",
				"-c",
				"protocol.allow=never",
				...args,
			],
			{
				cwd: root,
				encoding: "buffer",
				maxBuffer: 8 * 1024 * 1024,
				timeout: 10_000,
				killSignal: "SIGKILL",
				signal,
				env: {
					PATH: process.env["PATH"],
					SystemRoot: process.env["SystemRoot"],
					LANG: "C",
					GIT_CONFIG_NOSYSTEM: "1",
					GIT_CONFIG_SYSTEM: "/dev/null",
					GIT_CONFIG_GLOBAL: "/dev/null",
					GIT_ATTR_NOSYSTEM: "1",
					GIT_NO_REPLACE_OBJECTS: "1",
					GIT_NO_LAZY_FETCH: "1",
					// Deny every transport, including locally enabled protocol-specific overrides.
					GIT_ALLOW_PROTOCOL: "",
					GIT_TERMINAL_PROMPT: "0",
					GIT_OPTIONAL_LOCKS: "0",
				},
			},
			(error, stdout) => {
				if (!error && !signal.aborted) return resolve(stdout);
				reject(
					new GitReadError(
						signal.aborted
							? "cancelled"
							: error?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
								? "limit"
								: "failed"
					)
				);
			}
		);
	});
}

/** Validate only a full, local commit object; never resolve a mutable ref or fetch it. */
export async function requireLocalCommit(
	root: string,
	sha: string,
	signal: AbortSignal
): Promise<void> {
	if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(sha))
		throw new Error("Reading-path revision must be a full commit ID");
	try {
		await readGit(root, ["cat-file", "-e", `${sha}^{commit}`], signal);
	} catch (error) {
		if (error instanceof GitReadError && error.reason === "cancelled") throw error;
		throw new Error(
			"Reading-path commit is unavailable locally; acquire the exact revision before retrying"
		);
	}
}
