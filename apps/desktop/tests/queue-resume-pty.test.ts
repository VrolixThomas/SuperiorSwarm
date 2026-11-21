import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IPty } from "node-pty";
import { PtyManager } from "../src/daemon/pty-manager";
import type { TerminalReplayBuffer } from "../src/daemon/terminal-replay-buffer";
import type { QueueLaunchOwner } from "../src/shared/queue-resume";
import type { TerminalProcessIdentity } from "../src/shared/terminal-files";
const disposals: (() => void)[] = [];
afterEach(() => {
	for (const dispose of disposals.splice(0)) dispose();
});
function setup(promptless = false) {
	const dir = mkdtempSync(join(tmpdir(), "queue-pty-unit-"));
	const executable = join(dir, "claude");
	writeFileSync(executable, "synthetic native identity");
	let nextPid = 100;
	let failSetup = false;
	const processes: {
		pid: number;
		file: string;
		args: string[];
		cols: number;
		rows: number;
		env: Record<string, string | undefined>;
		kills: string[];
		data: Set<(s: string) => void>;
		exit: Set<(e: { exitCode: number }) => void>;
		emit: (s: string) => void;
		finish: () => void;
	}[] = [];
	const identities = new Map<number, TerminalProcessIdentity>();
	const replays: {
		text: string;
		pending: { data: string; cb: (s: string) => void }[];
		disposed: boolean;
		flush: () => void;
	}[] = [];
	const signals: number[] = [];
	const manager = new PtyManager({
		environment: () => ({
			AGENT_NOTIFY_TERMINAL_ID: "owner",
			QUEUE_SYNTHETIC_ENV: "retained",
			CODEX_HOME: "/synthetic-shell-profile",
			QUEUE_AUTH_MARKER: "synthetic-credential",
		}),
		signal: (pid) => {
			signals.push(pid);
			const p = processes.find((p) => p.pid === pid);
			if (p) queueMicrotask(p.finish);
		},
		inspect: (pid) => identities.get(pid) ?? null,
		replay: () => {
			const r = {
				text: "",
				pending: [] as { data: string; cb: (s: string) => void }[],
				disposed: false,
				flush() {
					for (const p of r.pending.splice(0)) {
						r.text += p.data;
						p.cb(p.data);
					}
				},
			};
			replays.push(r);
			return {
				write: (data: string, cb: (s: string) => void) => r.pending.push({ data, cb }),
				snapshot: () => r.text,
				afterWrites: (fn: () => void) => {
					r.flush();
					fn();
				},
				resize: () => {},
				dispose: () => {
					r.disposed = true;
				},
			} as unknown as TerminalReplayBuffer;
		},
		spawn: (file, args, options) => {
			const data = new Set<(s: string) => void>();
			const exit = new Set<(e: { exitCode: number }) => void>();
			const pid = nextPid++;
			const process = {
				pid,
				file,
				args: args as string[],
				cols: options.cols ?? 80,
				rows: options.rows ?? 24,
				env: options.env ?? {},
				kills: [] as string[],
				data,
				exit,
				emit: (s: string) => {
					for (const fn of data) fn(s);
				},
				finish: () => {
					for (const fn of [...exit]) fn({ exitCode: 0 });
				},
			};
			processes.push(process);
			identities.set(pid, {
				pid,
				startedAt: `${pid}:0`,
				name: file.split("/").at(-1) ?? "",
				executable: file,
			});
			return {
				pid,
				process: file,
				write: () => {},
				resize: (cols: number, rows: number) => {
					process.cols = cols;
					process.rows = rows;
				},
				kill: (signal: string) => {
					process.kills.push(signal);
					queueMicrotask(process.finish);
				},
				onData: (fn: (s: string) => void) => {
					if (failSetup) {
						failSetup = false;
						throw Error("Injected post-spawn listener failure");
					}
					data.add(fn);
					return { dispose: () => data.delete(fn) };
				},
				onExit: (fn: (e: { exitCode: number }) => void) => {
					exit.add(fn);
					return { dispose: () => exit.delete(fn) };
				},
			} as unknown as IPty;
		},
	});
	disposals.push(() => {
		manager.disposeAll();
		rmSync(dir, { recursive: true, force: true });
	});
	const received: string[] = [];
	const second: string[] = [];
	let exits = 0;
	manager.create(
		"owner",
		dir,
		(s) => received.push(s),
		() => exits++,
		"c",
		{ AGENT_NOTIFY_TERMINAL_ID: "owner", QUEUE_SYNTHETIC_ENV: "retained" }
	);
	manager.create(
		"sibling",
		dir,
		() => {},
		() => exits++,
		"c"
	);
	manager.attach(
		"owner",
		(s) => second.push(s),
		() => exits++,
		"second"
	);
	manager.resize("owner", 132, 41);
	const owner: QueueLaunchOwner = {
		type: "terminal",
		workspaceId: "workspace",
		entity: { kind: "workspace", id: "workspace" },
		terminalId: "owner",
		provider: "claude",
		providerSessionId: crypto.randomUUID(),
	};
	const first = processes[0];
	if (!first) throw Error("Missing process");
	identities.set(first.pid, { pid: 777, startedAt: "777:0", name: "claude", executable });
	manager.write("owner", "initial\r");
	if (promptless) {
		expect(
			manager.fileInputs.registerLaunch("owner", owner, {
				provider: "claude",
				args: ["--tools", "", "--permission-mode", "plan"],
				initialPrompt: false,
			})
		).toBe(true);
		manager.write("owner", "first actual user prompt\r");
	}
	manager.fileInputs.conversationState("owner", {
		provider: "claude",
		providerSessionId: owner.providerSessionId!,
		turnId: "initial",
		phase: "prompt",
	});
	manager.fileInputs.conversationState("owner", {
		provider: "claude",
		providerSessionId: owner.providerSessionId!,
		turnId: "initial",
		phase: "idle",
	});
	if (!promptless)
		expect(
			manager.fileInputs.registerLaunch("owner", owner, {
				provider: "claude",
				args: ["--tools", "", "--permission-mode", "plan"],
			})
		).toBe(true);
	const sleep = manager.fileInputs.prepareSleep("owner", "c", "claude", owner.providerSessionId!);
	if (!sleep) throw Error("Missing sleep guard");
	identities.set(first.pid, {
		pid: first.pid,
		startedAt: `${first.pid}:0`,
		name: "sh",
		executable: "/bin/sh",
	});
	expect(manager.completeQueueSleep("owner", sleep.generation)).toBe(true);
	const lease = () => {
		const value = manager.fileInputs.resumeTarget("owner", "c", "claude", owner.providerSessionId!);
		if (!value?.supported) throw Error("Missing resume lease");
		return value.generation;
	};
	return {
		manager,
		signals,
		owner,
		processes,
		replays,
		received,
		second,
		first,
		lease,
		exits: () => exits,
		failSetup: () => {
			failSetup = true;
		},
	};
}
test("one-PTY resume preserves listeners, dimensions, cwd, callback environment and accepted replay tail", async () => {
	const f = setup();
	const sibling = f.manager.list().find((s) => s.id === "sibling")?.pid;
	f.first.emit("tail before swap");
	const content = "literal 'quotes'\n$(never evaluated)";
	expect(f.manager.resumeQueueProcess("owner", "c", f.lease(), content, f.owner)).toBe("admitted");
	await Promise.resolve();
	const child = f.processes.at(-1);
	if (!child) throw Error("Missing child");
	expect(child.cols).toBe(132);
	expect(child.rows).toBe(41);
	expect(child.env["QUEUE_SYNTHETIC_ENV"]).toBe("retained");
	expect(child.env["AGENT_NOTIFY_TERMINAL_ID"]).toBe("owner");
	expect(child.env["CODEX_HOME"]).toBe("/synthetic-shell-profile");
	expect(child.env["QUEUE_AUTH_MARKER"]).toBe("synthetic-credential");
	expect(child.args).toEqual([
		"--tools",
		"",
		"--permission-mode",
		"plan",
		"--resume",
		f.owner.providerSessionId!,
		"--",
		content,
	]);
	expect(f.first.kills).toEqual(["SIGKILL"]);
	expect(f.exits()).toBe(0);
	expect(f.manager.list().find((s) => s.id === "sibling")?.pid).toBe(sibling);
	f.replays[0]?.flush();
	expect(f.received).toEqual(["tail before swap"]);
	expect(f.second).toEqual(f.received);
	expect(f.manager.getBuffer("owner")).toBe("tail before swap");
	f.first.emit("retired bytes");
	f.first.finish();
	expect(f.manager.has("owner")).toBe(true);
	expect(f.replays[0]?.disposed).toBe(false);
});
test("a directly resumed provider parks and resumes again without closing any terminal", async () => {
	const f = setup();
	const content = "next task";
	expect(f.manager.resumeQueueProcess("owner", "c", f.lease(), content, f.owner)).toBe("admitted");
	const state = {
		provider: "claude",
		providerSessionId: f.owner.providerSessionId!,
		turnId: "second",
		promptHash: createHash("sha256").update(content).digest("hex"),
	};
	f.manager.fileInputs.conversationState("owner", { ...state, phase: "prompt" });
	f.manager.fileInputs.conversationState("owner", { ...state, phase: "idle" });
	const sleep = f.manager.fileInputs.prepareSleep("owner", "c", "claude", state.providerSessionId);
	expect(sleep?.supported).toBe(true);
	if (!sleep) throw Error("No sleep");
	expect(await f.manager.parkQueueRoot("owner", sleep.generation)).toBe(true);
	expect(f.manager.completeQueueSleep("owner", sleep.generation)).toBe(true);
	expect(f.processes.at(-1)?.env["QUEUE_AUTH_MARKER"]).toBeUndefined();
	expect(f.manager.resumeQueueProcess("owner", "c", f.lease(), "third", f.owner)).toBe("admitted");
	expect(f.manager.terminalCount).toBe(2);
	expect(f.exits()).toBe(0);
});
test("a post-spawn publication failure is uncertain and consumes the one-shot lease", () => {
	const f = setup();
	const lease = f.lease();
	f.failSetup();
	const before = f.processes.length;
	expect(f.manager.resumeQueueProcess("owner", "c", lease, "possibly accepted", f.owner)).toBe(
		"uncertain"
	);
	expect(f.processes.length).toBe(before + 1);
	expect(f.processes.at(-1)?.kills).toEqual(["SIGKILL"]);
	expect(f.manager.list().find((s) => s.id === "owner")?.pid).toBe(f.first.pid);
	expect(f.manager.resumeQueueProcess("owner", "c", lease, "possibly accepted", f.owner)).toBe(
		"rejected"
	);
	expect(f.processes.length).toBe(before + 1);
});

test("promptless typed startup retires only its launcher boundary before the first manual turn", () => {
	const f = setup(true);
	expect(f.lease()).toBeTypeOf("string");
});

test("input arriving after preparation prevents daemon-owned sleep signalling", () => {
	const f = setup();
	const content = "task";
	expect(f.manager.resumeQueueProcess("owner", "c", f.lease(), content, f.owner)).toBe("admitted");
	const state = {
		provider: "claude",
		providerSessionId: f.owner.providerSessionId!,
		turnId: "ready",
		promptHash: createHash("sha256").update(content).digest("hex"),
	};
	f.manager.fileInputs.conversationState("owner", { ...state, phase: "prompt" });
	f.manager.fileInputs.conversationState("owner", { ...state, phase: "idle" });
	const sleep = f.manager.fileInputs.prepareSleep("owner", "c", "claude", state.providerSessionId);
	if (!sleep) throw Error("Missing guard");
	f.manager.write("owner", "new draft");
	expect(f.manager.signalQueueSleep("owner", sleep.generation)).toBe(false);
	expect(f.signals).toEqual([]);
});
