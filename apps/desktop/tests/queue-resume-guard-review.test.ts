import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileInputSessions, type FileInputTarget } from "../src/daemon/file-input-sessions";
import {
	type QueueLaunchDescriptor,
	type QueueLaunchOwner,
	queueResumeArgs,
	validQueueLaunch,
} from "../src/shared/queue-resume";
import type { QueueTerminalState } from "../src/shared/queue-terminal-state";
import type { TerminalProcessIdentity } from "../src/shared/terminal-files";

// Pure admission tests: files only supply executable identity stamps. Nothing is executed.
const temporaryDirectories: string[] = [];
afterEach(() => {
	for (const directory of temporaryDirectories.splice(0))
		rmSync(directory, { recursive: true, force: true });
});
const conversation = "11111111-1111-1111-1111-111111111111";
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
function supported(value: FileInputTarget | null): FileInputTarget {
	expect(value?.supported).toBe(true);
	if (!value?.supported) throw Error("Expected a supported fixture lease");
	return value;
}
function fixture(provider: "claude" | "codex" = "claude") {
	const directory = mkdtempSync(join(tmpdir(), "queue-resume-guard-"));
	temporaryDirectories.push(directory);
	const executable = join(directory, provider);
	writeFileSync(executable, "fixture executable identity only", { mode: 0o700 });
	let identity: TerminalProcessIdentity = {
		pid: 101,
		startedAt: "1:1",
		name: provider,
		executable,
	};
	const shell: TerminalProcessIdentity = {
		pid: 11,
		startedAt: "0:1",
		name: "zsh",
		executable: "/bin/zsh",
	};
	const writes: string[] = [];
	const sessions = new FileInputSessions();
	const owner: QueueLaunchOwner = {
		type: "terminal",
		entity: { kind: "workspace", id: "workspace" },
		workspaceId: "workspace",
		terminalId: "terminal",
		provider,
		providerSessionId: conversation,
	};
	const descriptor: QueueLaunchDescriptor = {
		provider,
		args: provider === "codex" ? ["--no-daemon", "--sandbox", "read-only"] : ["--tools", ""],
	};
	const state = (turnId: string, phase: QueueTerminalState["phase"], promptHash?: string) =>
		sessions.conversationState("terminal", {
			provider,
			providerSessionId: conversation,
			turnId,
			phase,
			promptHash,
		});
	sessions.create(
		"terminal",
		"main",
		"/bin/zsh",
		() => identity.name,
		(data) => writes.push(data),
		() => identity
	);
	sessions.input("terminal", "initial prompt\r");
	state("initial", "prompt");
	state("initial", "idle");
	expect(sessions.registerLaunch("terminal", owner, descriptor)).toBe(true);
	const prepare = () =>
		supported(sessions.prepareSleep("terminal", "main", provider, conversation));
	const asleep = () => {
		const lease = prepare();
		identity = shell;
		expect(sessions.completeSleep("terminal", lease.generation, shell.pid)).toBe(true);
		return lease;
	};
	const target = () => supported(sessions.resumeTarget("terminal", "main", provider, conversation));
	const startTrustedResume = (prompt: string | undefined) => {
		asleep();
		const lease = target();
		const launch = sessions.takeResume("terminal", "main", lease.generation, prompt, owner);
		expect(launch?.executable).toBe(executable);
		identity = { ...identity, pid: 303, startedAt: "3:3", name: provider, executable };
		sessions.replaceTransport(
			"terminal",
			() => identity.name,
			(data) => writes.push(data),
			() => identity
		);
		sessions.trustedLaunchProcess("terminal", identity.pid);
		sessions.admittedArgvPrompt("terminal", provider, conversation, prompt);
	};
	return {
		sessions,
		owner,
		descriptor,
		executable,
		writes,
		state,
		prepare,
		asleep,
		target,
		startTrustedResume,
		identity: () => identity,
		setIdentity: (value: TerminalProcessIdentity) => {
			identity = value;
		},
		live: () => sessions.conversationTarget("terminal", "main", provider, conversation, false),
	};
}

for (const provider of ["claude", "codex"] as const) {
	test(`${provider}: a manual same-session process replacement cannot inherit app launch policy`, () => {
		const f = fixture(provider);
		f.setIdentity({ ...f.identity(), pid: 202, startedAt: "2:2" });
		f.sessions.input("terminal", "manual resume with different policy\r");
		f.state("manual", "prompt");
		f.state("manual", "idle");
		expect(f.live()?.supported).toBe(true); // Existing-process reply is a different capability.
		expect(f.sessions.prepareSleep("terminal", "main", provider, conversation)).toBeNull();
		expect(f.sessions.registerLaunch("terminal", f.owner, f.descriptor)).toBe(false);
	});

	test(`${provider}: only the exact admitted argv prompt establishes live reply readiness`, () => {
		const f = fixture(provider);
		const prompt = "Continue with the saved answer.";
		f.startTrustedResume(prompt);
		f.state("resume-start", "reset");
		f.state("resumed", "prompt", digest("another prompt"));
		f.state("resumed", "idle");
		expect(f.live()?.supported).toBe(false);
		f.state("resumed", "prompt", digest(prompt));
		f.state("resumed", "idle");
		expect(f.live()?.supported).toBe(true);
		expect(f.prepare().supported).toBe(true); // Trusted replacement supports another sleep cycle.
		expect(f.writes).toEqual([]); // Initial argv handoff never writes shell input.
	});
}

test("a resume lease cannot authorize ordinary file insertion into the retained shell", () => {
	const f = fixture();
	f.asleep();
	const lease = f.target();
	const text = " '/tmp/review-file' ";
	expect(f.sessions.insert("terminal", "main", lease.generation, text, text, true)).toBe(
		"rejected"
	);
	expect(f.writes).toEqual([]);
});

test("typing before completed sleep cannot be erased by the completion notification", () => {
	const f = fixture();
	const lease = f.prepare();
	f.setIdentity({ pid: 11, startedAt: "0:1", name: "zsh", executable: "/bin/zsh" });
	f.sessions.input("terminal", "unsent shell draft");
	expect(f.sessions.completeSleep("terminal", lease.generation, 11)).toBe(false);
	expect(f.sessions.resumeTarget("terminal", "main", "claude", conversation)?.supported).toBe(
		false
	);
});

test("typing after a resume lease prevents process handoff, including newline-containing drafts", () => {
	for (const input of ["draft", "\u001b[200~line one\nline two\u001b[201~", "\r"]) {
		const f = fixture();
		f.asleep();
		const lease = f.target();
		f.sessions.input("terminal", input);
		expect(
			f.sessions.takeResume("terminal", "main", lease.generation, "Continue", f.owner)
		).toBeNull();
		expect(f.writes).toEqual([]);
	}
});

test("a stale shell process or different owner cannot consume the resume lease", () => {
	const f = fixture();
	f.asleep();
	const lease = f.target();
	expect(
		f.sessions.takeResume("terminal", "main", lease.generation, "Continue", {
			...f.owner,
			entity: { kind: "coordinator", id: "workspace" },
		})
	).toBeNull();
	f.setIdentity({ ...f.identity(), startedAt: "reused-pid" });
	expect(
		f.sessions.takeResume("terminal", "main", lease.generation, "Continue", f.owner)
	).toBeNull();
	expect(f.writes).toEqual([]);
});

test("a matching argv callback cannot erase input typed after admission", () => {
	const f = fixture();
	const prompt = "Continue the exact conversation";
	f.startTrustedResume(prompt);
	f.sessions.input("terminal", "new draft");
	f.state("resumed", "prompt", digest(prompt));
	f.state("resumed", "idle");
	expect(f.live()?.supported).toBe(false);
});

test("wake without a prompt never manufactures prompt readiness", () => {
	const f = fixture();
	f.startTrustedResume(undefined);
	f.state("view-only", "reset");
	f.state("view-only", "idle");
	expect(f.live()?.supported).toBe(false);
});

test("changed executable identity invalidates a prepared resume", () => {
	const f = fixture();
	f.asleep();
	const lease = f.target();
	writeFileSync(f.executable, "different fixture executable identity; never executed");
	expect(
		f.sessions.takeResume("terminal", "main", lease.generation, "Continue", f.owner)
	).toBeNull();
});

test("Codex dedicated mode must be an actual parsed switch, not an option value", () => {
	expect(validQueueLaunch({ provider: "codex", args: ["--no-daemon", "--model", "example"] })).toBe(
		true
	);
	for (const flag of ["--model", "--config", "--profile"])
		expect(validQueueLaunch({ provider: "codex", args: [flag, "--no-daemon"] })).toBe(false);
});

test("resume argv retains policy and one literal prompt while refusing ambiguous selectors", () => {
	const descriptor: QueueLaunchDescriptor = {
		provider: "codex",
		args: ["--no-daemon", "--sandbox", "read-only"],
	};
	const prompt = "Quoted 'answer'; $(this stays literal)\nand another line";
	expect(queueResumeArgs(descriptor, conversation, prompt)).toEqual([
		"--no-daemon",
		"--sandbox",
		"read-only",
		"resume",
		conversation,
		"--",
		prompt,
	]);
	for (const selector of ["--last", "a named session", ""])
		expect(() => queueResumeArgs(descriptor, selector, prompt)).toThrow();
	expect(validQueueLaunch({ provider: "claude", args: ["--fork-session"] })).toBe(false);
	expect(
		validQueueLaunch({ provider: "codex", args: ["--no-daemon", "--remote", "unix://example"] })
	).toBe(false);
});
