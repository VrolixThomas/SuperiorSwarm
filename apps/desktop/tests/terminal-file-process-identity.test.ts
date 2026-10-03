import { afterAll, beforeAll, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as pty from "node-pty";
import { FileInputSessions } from "../src/daemon/file-input-sessions";
import { readTerminalProcessIdentity } from "../src/daemon/terminal-process-identity";
import type { TerminalProcessIdentity } from "../src/shared/terminal-files";
const helperSource = resolve(import.meta.dir, "../src/daemon/terminal-process-info.c");
let root: string;
let helper: string;
beforeAll(() => {
	root = mkdtempSync(join(tmpdir(), "terminal-process-test-"));
	helper = join(root, "terminal-process-info");
	execFileSync("cc", [
		"-std=c11",
		"-Wall",
		"-Wextra",
		"-Werror",
		"-O2",
		helperSource,
		"-o",
		helper,
	]);
});
afterAll(() => {
	if (root) rmSync(root, { recursive: true, force: true });
});
const identity = (executable: string): TerminalProcessIdentity => ({
	pid: 42,
	startedAt: "123:456",
	executable,
	name: "2.1.227",
});
test("Claude native version names are recognized only through an inspected install path", () => {
	let current = identity("/Users/fixture/.local/share/claude/versions/2.1.227");
	const writes: string[] = [];
	const sessions = new FileInputSessions();
	sessions.create(
		"term",
		"client",
		"/bin/zsh",
		() => current.name,
		(data) => writes.push(data),
		() => current
	);
	const target = sessions.target("term", "client")!;
	expect(target.supported).toBe(true);
	expect(
		sessions.insert("term", "client", target.generation, " '/fixture/a.pdf' ", " '/fixture/a.pdf' ")
	).toBe("admitted");
	expect(writes).toEqual([" '/fixture/a.pdf' "]);
	for (const path of [
		"/tmp/2.1.227",
		"/usr/bin/ssh",
		"/tmp/.local/share/claude/versions/not-a-version",
		"/tmp/.local/share/claude/versions/2.1.227/ssh",
	]) {
		current = identity(path);
		expect(sessions.target("term", "client")?.supported).toBe(false);
	}
});
test("same-name process replacement, executable change and failed inspection invalidate the lease", () => {
	for (const change of ["pid", "start", "executable", "missing"]) {
		let current: TerminalProcessIdentity | null = identity(
			"/Users/fixture/.claude/versions/2.1.227"
		);
		const writes: string[] = [];
		const sessions = new FileInputSessions();
		sessions.create(
			"term",
			"client",
			"/bin/zsh",
			() => "2.1.227",
			(data) => writes.push(data),
			() => current
		);
		const target = sessions.target("term", "client")!;
		expect(target.supported).toBe(true);
		current =
			change === "missing"
				? null
				: {
						...current,
						...(change === "pid"
							? { pid: 43 }
							: change === "start"
								? { startedAt: "123:999" }
								: { executable: "/usr/bin/ssh" }),
					};
		expect(
			sessions.insert("term", "client", target.generation, " '/fixture/a' ", " '/fixture/a' ", true)
		).toBe("rejected");
		expect(writes).toEqual([]);
	}
});
test("numeric process name alone and renderer-managed hints do not qualify arbitrary programs", () => {
	const sessions = new FileInputSessions();
	sessions.create(
		"term",
		"client",
		"/bin/zsh",
		() => "2.1.227",
		() => {}
	);
	expect(sessions.target("term", "client", true)?.supported).toBe(false);
});
test("native helper inspects a generated executable without reading command arguments", async () => {
	if (process.platform !== "darwin") return;
	const directory = join(root, ".local/share/claude/versions");
	mkdirSync(directory, { recursive: true });
	const source = join(root, "fixture.c");
	const executable = join(directory, "2.1.227");
	writeFileSync(source, "#include <unistd.h>\nint main(void) { for (;;) pause(); }\n");
	execFileSync("cc", [source, "-o", executable]);
	const child = pty.spawn(executable, ["generated-argument-not-for-output"], {
		cwd: root,
		env: { TERM: "xterm" },
		cols: 80,
		rows: 24,
	});
	try {
		let result = readTerminalProcessIdentity(child.pid, helper);
		for (let attempt = 0; attempt < 100 && result?.name !== "2.1.227"; attempt++) {
			await new Promise((resolve) => setTimeout(resolve, 10));
			result = readTerminalProcessIdentity(child.pid, helper);
		}
		expect(result?.name).toBe("2.1.227");
		expect(result?.executable.endsWith("/.local/share/claude/versions/2.1.227")).toBe(true);
		expect(result?.pid).toBe(child.pid);
		expect(JSON.stringify(result)).not.toContain("generated-argument");
		// Emulate exec() between native metadata reads. PID/start time remain the same.
		const racedSource = join(root, "raced-inspector.c");
		const racedHelper = join(root, "raced-inspector");
		writeFileSync(
			racedSource,
			`
#include <libproc.h>
static int calls = 0;
static int changing_path(int pid, void *buffer, uint32_t size) {
 int result = proc_pidpath(pid, buffer, size);
 if (++calls > 1 && result > 0) ((char *)buffer)[1] = '!';
 return result;
}
#define proc_pidpath changing_path
#include ${JSON.stringify(helperSource)}
`
		);
		execFileSync("cc", ["-Wall", "-Wextra", "-Werror", racedSource, "-o", racedHelper]);
		expect(readTerminalProcessIdentity(child.pid, racedHelper) === null).toBe(true);
	} finally {
		child.kill("SIGKILL");
	}
});
