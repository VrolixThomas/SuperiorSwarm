// tests/agent-hooks/listener.test.ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type AgentAlertListener, createAlertListener } from "../../src/main/agent-hooks/listener";
import { agentRegistry } from "../../src/shared/agent-events";
import type { AgentHookConfig } from "../../src/shared/agent-events";

// Register a mock agent for testing
const mockAgent: AgentHookConfig = {
	name: "test-agent",
	settingsPath: "",
	hookEvents: ["Stop", "PermissionRequest", "PostToolUse"],
	mapEvent: (raw) => {
		if (raw === "Stop") return "task-complete";
		if (raw === "PermissionRequest") return "needs-input";
		if (raw === "PostToolUse") return "active";
		return null;
	},
	setup: async () => {},
};

describe("AgentAlertListener", () => {
	let listener: AgentAlertListener;
	const PORT = 27399; // test port to avoid conflict

	beforeAll(async () => {
		agentRegistry.set("test-agent", mockAgent);
		listener = createAlertListener(PORT);
		await listener.start();
	});

	afterAll(() => {
		listener.stop();
		agentRegistry.delete("test-agent");
	});

	test("returns 200 and maps rawEvent via agent registry", async () => {
		const url = `http://127.0.0.1:${PORT}/event?rawEvent=Stop&sessionId=s1&workspaceId=w1&agent=test-agent`;
		const res = await fetch(url);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.ok).toBe(true);
		expect(body.alert).toBe("task-complete");
	});

	test("returns 400 for missing rawEvent param", async () => {
		const url = `http://127.0.0.1:${PORT}/event?sessionId=s1&agent=test-agent`;
		const res = await fetch(url);
		expect(res.status).toBe(400);
	});

	test("returns 204 for unknown agent (silently ignored)", async () => {
		const url = `http://127.0.0.1:${PORT}/event?rawEvent=Stop&sessionId=s1&agent=unknown-agent`;
		const res = await fetch(url);
		expect(res.status).toBe(204);
	});

	test("returns 204 when agent mapper returns null (unrecognised event)", async () => {
		const url = `http://127.0.0.1:${PORT}/event?rawEvent=SomeUnknownEvent&sessionId=s1&agent=test-agent`;
		const res = await fetch(url);
		expect(res.status).toBe(204);
	});

	test("returns 404 for unknown paths", async () => {
		const url = `http://127.0.0.1:${PORT}/unknown`;
		const res = await fetch(url);
		expect(res.status).toBe(404);
	});

	test("emits AgentEvent on valid request", async () => {
		const events: Array<{ alert: string; workspaceId: string }> = [];
		const unsub = listener.onEvent((ev) => {
			events.push({ alert: ev.alert, workspaceId: ev.workspaceId });
		});

		const url = `http://127.0.0.1:${PORT}/event?rawEvent=PermissionRequest&sessionId=s2&workspaceId=w2&agent=test-agent`;
		await fetch(url);

		expect(events).toHaveLength(1);
		expect(events[0]).toEqual({ alert: "needs-input", workspaceId: "w2" });
		unsub();
	});

	test("getPort returns the bound port", () => {
		expect(listener.getPort()).toBe(PORT);
	});
});

describe("EADDRINUSE fallback", () => {
	let blocker: AgentAlertListener;
	let fallback: AgentAlertListener;
	const BLOCKED_PORT = 27398;

	beforeAll(async () => {
		blocker = createAlertListener(BLOCKED_PORT);
		await blocker.start();
		// Create a second listener on the same port — should fallback to OS port
		fallback = createAlertListener(BLOCKED_PORT);
		await fallback.start();
	});

	afterAll(() => {
		fallback.stop();
		blocker.stop();
	});

	test("fallback listener binds to a different port", () => {
		const fallbackPort = fallback.getPort();
		expect(fallbackPort).not.toBeNull();
		expect(fallbackPort).not.toBe(BLOCKED_PORT);
	});

	test("fallback listener still serves requests", async () => {
		const fallbackPort = fallback.getPort()!;
		agentRegistry.set("test-agent", mockAgent);
		const url = `http://127.0.0.1:${fallbackPort}/event?rawEvent=Stop&sessionId=s1&workspaceId=w1&agent=test-agent`;
		const res = await fetch(url);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { ok: boolean; alert: string };
		expect(body.ok).toBe(true);
		expect(body.alert).toBe("task-complete");
	});
});
