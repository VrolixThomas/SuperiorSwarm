import { expect, test } from "bun:test";
import { FileInputSessions } from "../src/daemon/file-input-sessions";
const claude = { pid: 123, startedAt: "one", name: "claude", executable: "/opt/bin/claude" };
function fixture() {
	const sessions = new FileInputSessions();
	let identity = claude;
	const writes: string[] = [];
	sessions.create(
		"t",
		"c",
		"/bin/zsh",
		() => identity.name,
		(d) => writes.push(d),
		() => identity
	);
	sessions.input("t", "initial\r");
	sessions.conversationState("t", {
		provider: "claude",
		providerSessionId: "chat",
		turnId: "turn",
		phase: "prompt",
	});
	sessions.conversationState("t", {
		provider: "claude",
		providerSessionId: "chat",
		turnId: "turn",
		phase: "idle",
	});
	return {
		sessions,
		writes,
		replace: (v: typeof claude) => {
			identity = v;
		},
	};
}
test("conversation admission requires exact provider executable, excludes shells and generic runtimes", () => {
	const f = fixture();
	expect(f.sessions.conversationTarget("t", "c", "claude", "chat")?.supported).toBe(true);
	expect(f.sessions.conversationTarget("t", "c", "codex", "chat")?.supported).toBe(false);
	for (const name of ["zsh", "node", "bun", "ssh"]) {
		f.replace({ ...claude, name, executable: `/bin/${name}` });
		expect(f.sessions.conversationTarget("t", "c", "claude", "chat")?.supported).toBe(false);
	}
});
test("admission is single-use, bracketed, and invalidated by any ordinary typing", () => {
	const f = fixture();
	const lease = f.sessions.conversationTarget("t", "c", "claude", "chat")!;
	expect(f.sessions.insertConversation("t", "c", lease.generation, "hello\nworld")).toBe(
		"admitted"
	);
	expect(f.writes).toEqual(["\x1b[200~hello\nworld\x1b[201~\r"]);
	expect(f.sessions.insertConversation("t", "c", lease.generation, "again")).toBe("rejected");
	const next = f.sessions.conversationTarget("t", "c", "claude", "chat")!;
	f.sessions.input("t", "x");
	expect(f.sessions.insertConversation("t", "c", next.generation, "again")).toBe("rejected");
});
test("process replacement and controls fail closed with no write", () => {
	const f = fixture();
	const lease = f.sessions.conversationTarget("t", "c", "claude", "chat")!;
	f.replace({ ...claude, startedAt: "two" });
	expect(f.sessions.insertConversation("t", "c", lease.generation, "hello")).toBe("rejected");
	const next = f.sessions.conversationTarget("t", "c", "claude", "chat")!;
	expect(f.sessions.insertConversation("t", "c", next.generation, "\x1b[201~oops")).toBe(
		"rejected"
	);
	expect(f.writes).toEqual([]);
});
test("an existing user draft cannot be combined with a queue reply", () => {
	const f = fixture();
	f.sessions.input("t", "already typing");
	expect(f.sessions.conversationTarget("t", "c", "claude", "chat")?.supported).toBe(false);
	expect(f.writes).toEqual([]);
});

test("multiline paste, Enter, Ctrl-C and a queued draft never reset dirty state", () => {
	for (const data of ["\x1b[200~multi\nline\x1b[201~", "\r", "\x03"]) {
		const f = fixture();
		f.sessions.input("t", data);
		f.sessions.conversationState("t", {
			provider: "claude",
			providerSessionId: "chat",
			turnId: "turn",
			phase: "idle",
		});
		expect(f.sessions.conversationTarget("t", "c", "claude", "chat")?.supported).toBe(false);
	}
	const f = fixture();
	f.sessions.input("t", "next\r");
	f.sessions.input("t", "draft after Enter before hook");
	f.sessions.conversationState("t", {
		provider: "claude",
		providerSessionId: "chat",
		turnId: "next",
		phase: "prompt",
	});
	f.sessions.conversationState("t", {
		provider: "claude",
		providerSessionId: "chat",
		turnId: "next",
		phase: "idle",
	});
	expect(f.sessions.conversationTarget("t", "c", "claude", "chat")?.supported).toBe(false);
});
test("only a fresh correlated completed turn restores admission, other conversations do not", () => {
	const f = fixture();
	f.sessions.input("t", "new turn\r");
	f.sessions.conversationState("t", {
		provider: "claude",
		providerSessionId: "chat",
		turnId: "next",
		phase: "prompt",
	});
	f.sessions.conversationState("t", {
		provider: "claude",
		providerSessionId: "wrong",
		turnId: "next",
		phase: "idle",
	});
	expect(f.sessions.conversationTarget("t", "c", "claude", "chat")?.supported).toBe(false);
	f.sessions.conversationState("t", {
		provider: "claude",
		providerSessionId: "chat",
		turnId: "next",
		phase: "idle",
	});
	expect(f.sessions.conversationTarget("t", "c", "claude", "chat")?.supported).toBe(true);
	f.replace({ ...claude, startedAt: "replacement" });
	expect(f.sessions.conversationTarget("t", "c", "claude", "chat")?.supported).toBe(false);
});
test("read-only capability polling cannot replace an in-flight admission lease", () => {
	const f = fixture();
	const lease = f.sessions.conversationTarget("t", "c", "claude", "chat")!;
	f.sessions.conversationTarget("t", "c", "claude", "chat", false);
	f.sessions.conversationTarget("t", "c", "claude", "chat", false);
	expect(f.sessions.insertConversation("t", "c", lease.generation, "exactly once")).toBe(
		"admitted"
	);
	expect(f.writes).toHaveLength(1);
});
test("two submissions before the first hook cannot attribute the second Enter to the first turn", () => {
	const f = fixture();
	f.sessions.input("t", "first\r");
	f.sessions.input("t", "queued second\r");
	f.sessions.conversationState("t", {
		provider: "claude",
		providerSessionId: "chat",
		turnId: "first",
		phase: "prompt",
	});
	f.sessions.conversationState("t", {
		provider: "claude",
		providerSessionId: "chat",
		turnId: "first",
		phase: "prompt",
	});
	f.sessions.conversationState("t", {
		provider: "claude",
		providerSessionId: "chat",
		turnId: "first",
		phase: "idle",
	});
	expect(f.sessions.conversationTarget("t", "c", "claude", "chat")?.supported).toBe(false);
	f.sessions.conversationState("t", {
		provider: "claude",
		providerSessionId: "chat",
		turnId: "second",
		phase: "prompt",
	});
	f.sessions.conversationState("t", {
		provider: "claude",
		providerSessionId: "chat",
		turnId: "second",
		phase: "idle",
	});
	expect(f.sessions.conversationTarget("t", "c", "claude", "chat")?.supported).toBe(true);
});
test("multiple uncorrelated submissions in one chunk remain unavailable", () => {
	const f = fixture();
	f.sessions.input("t", "first\rsecond\r");
	f.sessions.conversationState("t", {
		provider: "claude",
		providerSessionId: "chat",
		turnId: "first",
		phase: "prompt",
	});
	f.sessions.conversationState("t", {
		provider: "claude",
		providerSessionId: "chat",
		turnId: "first",
		phase: "idle",
	});
	expect(f.sessions.conversationTarget("t", "c", "claude", "chat")?.supported).toBe(false);
});
test("provider slash commands and shell shortcuts are not ordinary Queue replies", () => {
	for (const text of ["/resume other-chat", "  /clear", "!echo unsafe", "\n!pwd"]) {
		const f = fixture();
		const lease = f.sessions.conversationTarget("t", "c", "claude", "chat")!;
		expect(f.sessions.insertConversation("t", "c", lease.generation, text)).toBe("rejected");
		expect(f.writes).toHaveLength(0);
	}
});
test("unknown lifecycle phases cannot establish composer readiness", () => {
	const f = fixture();
	f.sessions.input("t", "next\r");
	const state = { provider: "claude", providerSessionId: "chat", turnId: "next" };
	f.sessions.conversationState("t", { ...state, phase: "prompt" });
	f.sessions.conversationState("t", { ...state, phase: "unknown" as "idle" });
	expect(f.sessions.conversationTarget("t", "c", "claude", "chat")?.supported).toBe(false);
	f.sessions.conversationState("t", { ...state, phase: "idle" });
	expect(f.sessions.conversationTarget("t", "c", "claude", "chat")?.supported).toBe(true);
});

test("daemon also rejects overlong replies before any terminal write", () => {
	const f = fixture();
	const lease = f.sessions.conversationTarget("t", "c", "claude", "chat");
	if (!lease) throw Error("Missing fixture lease");
	expect(f.sessions.insertConversation("t", "c", lease.generation, "x".repeat(4001))).toBe(
		"rejected"
	);
	expect(f.writes).toEqual([]);
});
