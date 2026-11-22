import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeConfig } from "../../src/main/agent-hooks/agents/claude";
import { codexConfig } from "../../src/main/agent-hooks/agents/codex";
import { HOOK_BRIDGE_SOURCE, buildHookLauncher } from "../../src/main/agent-hooks/bridge";
import { publishHookEndpoint } from "../../src/main/agent-hooks/endpoint";
import { type AgentAlertListener, createAlertListener } from "../../src/main/agent-hooks/listener";
import { type AgentEvent, agentRegistry } from "../../src/shared/agent-events";

let listener: AgentAlertListener | undefined;
let directory: string | undefined;
afterEach(() => {
	listener?.stop();
	if (directory) rmSync(directory, { recursive: true, force: true });
});

test("generated launcher parses top-level identities and sends authenticated turn metadata", async () => {
	agentRegistry.set("codex", codexConfig);
	listener = createAlertListener(0, "test-token");
	await listener.start();
	const events: AgentEvent[] = [];
	listener.onEvent((event) => events.push(event));
	directory = mkdtempSync(join(tmpdir(), "hook bridge ' "));
	const bridge = join(directory, "bridge.cjs");
	const launcher = join(directory, "on-event.sh");
	writeFileSync(bridge, HOOK_BRIDGE_SOURCE);
	writeFileSync(launcher, buildHookLauncher(bridge, process.execPath));
	const run = async (
		payload: string,
		token = "test-token",
		inheritedPort = String(listener?.getPort()),
		provider = "codex"
	) => {
		const child = Bun.spawn(["/bin/bash", launcher], {
			stdin: new Response(payload),
			stdout: "pipe",
			stderr: "pipe",
			env: {
				...process.env,
				AGENT_NOTIFY_PORT: inheritedPort,
				AGENT_NOTIFY_TOKEN: token,
				AGENT_NOTIFY_AGENT: provider,
				AGENT_NOTIFY_TERMINAL_ID: "terminal",
				AGENT_NOTIFY_WORKSPACE_ID: "workspace",
			},
		});
		const output = await new Response(child.stdout).text();
		expect(await child.exited).toBe(0);
		return output;
	};
	const started = Date.now();
	expect(
		await run(
			JSON.stringify({
				nested: { session_id: "WRONG", turn_id: "WRONG", hook_event_name: "Stop" },
				hook_event_name: "UserPromptSubmit",
				session_id: 'session-"escaped',
				turn_id: "turn-1",
				cwd: "/tmp",
			})
		)
	).toBe("");
	expect(events).toHaveLength(1);
	expect(events[0]).toMatchObject({
		rawEvent: "UserPromptSubmit",
		alert: "active",
		terminalId: "terminal",
		workspaceId: "workspace",
		providerSessionId: 'session-"escaped',
		turnId: "turn-1",
	});
	expect(events[0]?.producerTimestamp).toBeGreaterThanOrEqual(started);
	expect(events[0]?.timestamp).toBeGreaterThanOrEqual(events[0]?.producerTimestamp ?? 0);
	expect(
		await run(JSON.stringify({ hook_event_name: "Stop", session_id: "session", turn_id: "turn-1" }))
	).toBe("{}\n");
	expect(events).toHaveLength(2);
	await run(JSON.stringify({ hook_event_name: "Stop", agent_id: "child", session_id: "parent" }));
	await run(JSON.stringify({ hook_event_name: "SubagentStop", session_id: "parent" }));
	await run('{"nested":{"session_id":"nested"},"hook_event_name":42}');
	await run("not json");
	await run(JSON.stringify({ hook_event_name: "Stop", session_id: "session" }), "wrong-token");
	expect(events).toHaveLength(2);
	// Rebind after app restart; the shell still carries the previous port.
	const oldPort = String(listener.getPort());
	listener.stop();
	listener = createAlertListener(0, "test-token");
	await listener.start();
	listener.onEvent((event) => events.push(event));
	publishHookEndpoint(
		"terminal",
		listener.getPort() ?? 0,
		"test-token",
		join(directory, "endpoints")
	);
	await run(
		JSON.stringify({
			hook_event_name: "UserPromptSubmit",
			session_id: "session",
			turn_id: "after-restart",
		}),
		"test-token",
		oldPort
	);
	expect(events.at(-1)?.turnId).toBe("after-restart");
	// A terminal created before the listener binds need not have any inherited port.
	await run(
		JSON.stringify({
			hook_event_name: "PostToolUse",
			session_id: "session",
			turn_id: "after-restart",
		}),
		"test-token",
		""
	);
	expect(events).toHaveLength(4);
	agentRegistry.set("claude", claudeConfig);
	await run(
		JSON.stringify({
			hook_event_name: "UserPromptSubmit",
			session_id: "claude-session",
			prompt_id: "claude-prompt-2",
			prompt: " exact prompt ",
		}),
		"test-token",
		"",
		"claude"
	);
	expect(events.at(-1)).toMatchObject({
		agent: "claude",
		turnId: "claude-prompt-2",
		providerSessionId: "claude-session",
	});
	await run(
		JSON.stringify({
			hook_event_name: "Stop",
			session_id: "claude-session",
			prompt_id: "claude-prompt-2",
			event_id: "provider-event-2",
			event_timestamp: started,
			last_assistant_message: "Which color: amber or blue?\u001b[31m",
			prompt: "PRIVATE_PROMPT_MUST_NOT_BE_IMPORTED",
			tool_input: { command: "PRIVATE_TOOL" },
		}),
		"test-token",
		"",
		"claude"
	);
	expect(events.at(-1)).toMatchObject({
		providerEventId: "provider-event-2",
		providerTimestamp: started,
		evidence: [
			{
				text: "Which color: amber or blue?",
				sourceField: "last_assistant_message",
				provider: "claude",
				rawEvent: "Stop",
				kind: "reply",
			},
		],
	});
	expect(JSON.stringify(events.at(-1))).not.toContain("PRIVATE");
	await run(
		JSON.stringify({
			hook_event_name: "PermissionRequest",
			session_id: "session",
			turn_id: "turn-1",
			permission_request_id: "permission-1",
			permission_prompt: "Allow synthetic status?",
			permission: { outcome: "allowed" },
			tool_input: { secret: "PRIVATE" },
		}),
		"test-token",
		"",
		"codex"
	);
	expect(events.at(-1)?.permission).toEqual({ requestId: "permission-1", outcome: "pending" });
	expect(events.at(-1)?.evidence?.[0]?.text).toBe("Allow synthetic status?");
	await run(
		JSON.stringify({
			hook_event_name: "StopFailure",
			session_id: "claude-session",
			prompt_id: "claude-prompt-2",
			prompt: " exact prompt ",
			error: "Synthetic error password=syntheticsecret",
			last_assistant_message: "Unable to continue",
		}),
		"test-token",
		"",
		"claude"
	);
	expect(
		events
			.at(-1)
			?.evidence?.some(
				(e) => e.kind === "error" && e.text === "Synthetic error password=[redacted]"
			)
	).toBe(true);
});
