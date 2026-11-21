import "./preload-electron-mock";
import { beforeAll, expect, test } from "bun:test";
import { ActivityQueueService } from "../src/main/activity-queue/service";
import { getDb } from "../src/main/db";
import { terminalSessions } from "../src/main/db/schema";
import { AgentSessionManager } from "../src/main/services/agent-session-manager";
import type { DaemonClient } from "../src/main/terminal/daemon-client";
import type { AgentEvent } from "../src/shared/agent-events";
import { admitAgentEvidence } from "../src/shared/agent-evidence";
import { seedProject, seedWorkspace, setupTestDb } from "./helpers/db";

beforeAll(setupTestDb);
for (const provider of ["claude", "codex"] as const) {
	test(`${provider}: acknowledged failure stays handled through Stop, compaction and missing-turn replay`, async () => {
		const projectId = await seedProject();
		const workspaceId = await seedWorkspace(projectId, { name: "Synthetic evidence receipt" });
		const terminalId = `evidence-${workspaceId}`;
		getDb()
			.insert(terminalSessions)
			.values({
				id: terminalId,
				workspaceId,
				title: "Synthetic",
				cwd: "/tmp/synthetic",
				sortOrder: 0,
				updatedAt: new Date(),
			})
			.run();
		const manager = new AgentSessionManager({
			daemonClient: {} as DaemonClient,
			processController: {
				inspectForeground: async () => ({ status: "missing" }),
				terminateForeground: async () => ({ ok: true }),
			},
			getSettings: () => ({ enabled: false, idleMinutes: 5, keepOrchestratorsAwake: true }),
		});
		const queue = new ActivityQueueService();
		let timestamp = Date.now();
		function deliver(rawEvent: string, turnId: string | undefined = "failure-turn") {
			const event: AgentEvent = {
				agent: provider,
				terminalId,
				sessionId: terminalId,
				workspaceId,
				providerSessionId: `conversation-${workspaceId}`,
				cwd: "/tmp/synthetic",
				timestamp: ++timestamp,
				producerTimestamp: timestamp,
				rawEvent,
				turnId,
				alert:
					rawEvent === "StopFailure"
						? "needs-input"
						: rawEvent === "Stop"
							? "task-complete"
							: "active",
				evidence:
					rawEvent === "StopFailure"
						? admitAgentEvidence({ error: "Synthetic provider failure" }, provider, rawEvent)
						: [],
			};
			return manager.handleAgentEvent(event);
		}
		const pending = () =>
			queue
				.list()
				.items.filter((i) => i.target.type === "terminal" && i.target.terminalId === terminalId);
		try {
			deliver("StopFailure");
			const item = pending()[0];
			expect(item?.summary).toBe("Synthetic provider failure");
			expect(queue.acknowledge({ id: item?.id ?? "", revision: item?.revision ?? -1 }).status).toBe(
				"acknowledged"
			);
			for (const rawEvent of ["Stop", "PostCompact", "PreToolUse"]) {
				deliver(rawEvent);
				expect(pending()).toHaveLength(0);
				expect(manager.getSession(terminalId)?.state).toBe("needs-input");
			}
			// Explicit undefined via object spread (default parameters otherwise restore turn ID).
			manager.handleAgentEvent({
				agent: provider,
				terminalId,
				sessionId: terminalId,
				workspaceId,
				providerSessionId: `conversation-${workspaceId}`,
				cwd: "/tmp/synthetic",
				timestamp: ++timestamp,
				producerTimestamp: timestamp,
				rawEvent: "Stop",
				alert: "task-complete",
			});
			expect(pending()).toHaveLength(0);
			expect(queue.read(item?.id ?? "")?.revision).toBe(item?.revision);
			deliver("UserPromptSubmit", "genuine-next-turn");
			deliver("Stop", "genuine-next-turn");
			expect(pending()).toHaveLength(1);
			expect(pending()[0]?.kind).toBe("agent-ready");
		} finally {
			manager.dispose();
		}
	});
}
