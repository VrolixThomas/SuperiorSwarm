import assert from "node:assert/strict";
import { spawn } from "node:child_process";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: string[] = [];
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeConfig } from "../../../src/main/agent-hooks/agents/claude";
import { codexConfig } from "../../../src/main/agent-hooks/agents/codex";
import { HOOK_BRIDGE_SOURCE } from "../../../src/main/agent-hooks/bridge";
import { createAlertListener } from "../../../src/main/agent-hooks/listener";
import { QueuePermissions } from "../../../src/main/agent-hooks/queue-permissions";
import type { WorkspaceQueueItem } from "../../../src/shared/activity-queue";
import { agentRegistry } from "../../../src/shared/agent-events";

for (const provider of ["claude", "codex"] as const)
	for (const action of ["allow-once", "deny", "open", "timeout", "cancel"] as const) {
		process.title = provider;
		const label = `native Node bridge + HTTP, provider stand-in ${provider} ${action}`;
		await (async () => {
			const root = mkdtempSync(join(tmpdir(), "ss-permission-transport-"));
			writeFileSync(join(root, "bridge.cjs"), HOOK_BRIDGE_SOURCE);
			const token = randomUUID();
			const target = {
				type: "terminal" as const,
				entity: { kind: "workspace" as const, id: "w" },
				workspaceId: "w",
				terminalId: "t",
				provider,
				providerSessionId: "c",
			};
			const service = new QueuePermissions({
				currentGeneration: () => "g",
				timeoutMs: action === "timeout" ? 100 : 2000,
			});
			agentRegistry.set(provider, provider === "claude" ? claudeConfig : codexConfig);
			const listener = createAlertListener(0, token, {
				service,
				resolve: () => ({ target, generation: "g" }),
			});
			let item: WorkspaceQueueItem | undefined;
			listener.onEvent((event) => {
				item = {
					id: "s",
					revision: 1,
					situation: "agent-permission",
					target,
					permission: event.permission,
					stale: false,
				} as WorkspaceQueueItem;
			});
			await listener.start();
			mkdirSync(join(root, "endpoints"), { recursive: true });
			writeFileSync(
				join(root, "endpoints", `${createHash("sha256").update(`${token}\0t`).digest("hex")}.json`),
				JSON.stringify({ port: listener.getPort(), permissionResponse: 1 })
			);
			try {
				const child = spawn(process.execPath, [join(root, "bridge.cjs")], {
					env: {
						...process.env,
						AGENT_NOTIFY_AGENT: provider,
						AGENT_NOTIFY_TOKEN: token,
						AGENT_NOTIFY_PORT: String(listener.getPort()),
						AGENT_NOTIFY_TERMINAL_ID: "t",
						AGENT_NOTIFY_WORKSPACE_ID: "w",
					},
					stdio: ["pipe", "pipe", "pipe"],
				});
				const done = new Promise<void>((resolve) => child.on("exit", () => resolve()));
				let output = "";
				child.stdout.on("data", (chunk) => {
					output += String(chunk);
				});
				child.stdin.write(
					JSON.stringify({
						hook_event_name: "PermissionRequest",
						session_id: "c",
						turn_id: "turn",
						tool_name: "Bash",
						tool_input: { command: "printf synthetic" },
					})
				);
				child.stdin.end();
				for (let i = 0; i < 100 && !item; i++) await sleep(10);
				assert.ok(item);
				const current = item!;
				assert.ok(service.capability(current).summary?.includes("printf synthetic"));
				assert.ok(!service.capability(current).summary?.includes("do-not-forward"));
				if (action === "cancel") child.kill();
				else if (action !== "timeout")
					assert.equal(
						service.decide(
							{ id: "s", revision: 1, requestId: current.permission!.requestId!, action },
							current
						).status,
						action === "open" ? "opened" : "sent"
					);
				await done;
				if (action === "allow-once" || action === "deny") {
					assert.deepEqual(JSON.parse(output), {
						hookSpecificOutput: {
							hookEventName: "PermissionRequest",
							decision: {
								behavior: action === "deny" ? "deny" : "allow",
								...(action === "deny"
									? { message: "Denied for this request in SuperiorSwarm Queue." }
									: {}),
							},
						},
					});
					assert.equal(service.capability(current).state, "delivered-to-hook");
				} else assert.equal(output, "");
				if (action === "cancel") {
					await sleep(20);
					assert.equal(service.capability(current).state, "cancelled");
				}
			} finally {
				listener.stop();
				rmSync(root, { recursive: true, force: true });
			}
		})();
		results.push(label);
	}

console.log(JSON.stringify({ passed: results }));
