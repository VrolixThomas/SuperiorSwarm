import {
	type ChildProcess,
	type ExecSyncOptionsWithStringEncoding,
	type SpawnOptions,
	execSync,
	spawn,
} from "node:child_process";

// Keep LSP process injection behind named adapter bindings. In particular, do
// not re-export Node's bindings directly: Bun's module mocks can otherwise
// replace the underlying built-in binding for unrelated test files.
export function execShellSync(command: string, options: ExecSyncOptionsWithStringEncoding): string {
	return execSync(command, options);
}

export function spawnLspProcess(
	command: string,
	args: readonly string[],
	options: SpawnOptions
): ChildProcess {
	return spawn(command, args, options);
}
