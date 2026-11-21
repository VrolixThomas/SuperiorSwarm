import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { BrowserWindow, app } from "electron";
import { QueueDeliveryAdmission } from "../../../src/daemon/queue-delivery";
import { workspaceReporter } from "../../../src/main/activity-queue/agent-source";
import { listWorkspaceQueue } from "../../../src/main/activity-queue/workspace-queue";
import { getDb } from "../../../src/main/db";
import {
	activityQueueDeliveries,
	agentMessages,
	agentSessions,
	projects,
	terminalSessions,
	workspaces,
} from "../../../src/main/db/schema";
import { AgentSessionManager } from "../../../src/main/services/agent-session-manager";
import type { DaemonClient } from "../../../src/main/terminal/daemon-client";
import { setDaemonClient } from "../../../src/main/terminal/daemon-instance";
import { rendererTrust } from "../../../src/main/terminal/renderer-trust";
import { router } from "../../../src/main/trpc";
import { setupTRPCIPC } from "../../../src/main/trpc/ipc-link";
function environment(name: string) {
	const value = process.env[name];
	if (!value) throw Error(`Missing ${name}`);
	return value;
}
const root = environment("SS_QUEUE_FIXTURE_ROOT");
app.setPath("userData", join(root, "profile"));
app.setPath("sessionData", join(root, "profile"));
app.setAppLogsPath(join(root, "profile", "logs"));
app.disableHardwareAcceleration();
app.on("window-all-closed", () => {});
let win: BrowserWindow | undefined;
const ids = ["claude-live", "codex-sleeping", "sibling", "busy"];
const writes: { id: string; content: string; mode: string; requestId: string }[] = [];
let busyBoundary = true;
const admission = (mode: "live" | "resume", id: string, requestId: string, content: string) => {
	if (id === "busy" && busyBoundary)
		getDb()
			.update(agentSessions)
			.set({ state: "running" })
			.where(eq(agentSessions.terminalId, id))
			.run();
	return new QueueDeliveryAdmission(getDb().$client).admit(
		requestId,
		id,
		content,
		() => {
			writes.push({ id, content, mode, requestId });
			return "admitted";
		},
		mode
	);
};
const daemon = {
	isConnected: true,
	supportsQueueReply: true,
	supportsQueueAnswer: true,
	supportsQueueResume: true,
	listSessionsStrict: async () => ids.map((id) => ({ id, pid: 1, cwd: root })),
	queueReplyTarget: async () => ({
		supported: true,
		generation: "controlled-live",
		foreground: "provider",
	}),
	queueResumeTarget: async () => ({
		supported: true,
		generation: "controlled-resume",
		foreground: "shell",
	}),
	submitQueueReply: async (id: string, _generation: string, requestId: string, content: string) =>
		admission("live", id, requestId, content),
	submitQueueResume: async (id: string, _generation: string, requestId: string, content: string) =>
		admission("resume", id, requestId, content),
};
const manager = new AgentSessionManager({
	daemonClient: daemon as unknown as DaemonClient,
	processController: {
		inspectForeground: async () => ({ status: "missing" }),
		terminateForeground: async () => ({ ok: true }),
	},
	getSettings: () => ({ enabled: false, idleMinutes: 5, keepOrchestratorsAwake: true }),
});
async function until(fn: () => boolean | Promise<boolean>) {
	for (let i = 0; i < 300; i++) {
		if (await fn()) return;
		await new Promise((r) => setTimeout(r, 25));
	}
	throw Error("Native answer assertion timed out");
}
async function run() {
	await app.whenReady();
	setDaemonClient(daemon as unknown as DaemonClient);
	if (!getDb().$client.name.startsWith(`${root}/`)) throw Error("Fixture DB escaped isolation");
	migrate(getDb(), { migrationsFolder: environment("SS_QUEUE_MIGRATIONS") });
	const { activityQueueRouter } = await import("../../../src/main/trpc/routers/activity-queue");
	const now = new Date();
	getDb()
		.insert(projects)
		.values({
			id: "project",
			name: "Answer fixture",
			repoPath: root,
			createdAt: now,
			updatedAt: now,
		})
		.run();
	getDb()
		.insert(workspaces)
		.values({
			id: "workspace",
			projectId: "project",
			name: "Exact answers",
			type: "worktree",
			createdAt: now,
			updatedAt: now,
		})
		.run();
	for (const id of ids) {
		const provider = id === "claude-live" ? "claude" : "codex";
		getDb()
			.insert(terminalSessions)
			.values({ id, workspaceId: "workspace", title: id, cwd: root, sortOrder: 0, updatedAt: now })
			.run();
		getDb()
			.insert(agentSessions)
			.values({
				terminalId: id,
				workspaceId: "workspace",
				entityKind: "workspace",
				provider,
				providerSessionId: `chat-${id}`,
				state: "idle",
				createdAt: now,
				updatedAt: now,
			})
			.run();
		manager.handleAgentEvent({
			agent: provider,
			sessionId: id,
			terminalId: id,
			workspaceId: "workspace",
			providerSessionId: `chat-${id}`,
			rawEvent: "Stop",
			alert: "task-complete",
			turnId: "initial",
			timestamp: Date.now(),
			cwd: root,
		});
		if (id === "codex-sleeping")
			getDb()
				.update(agentSessions)
				.set({ state: "hibernated" })
				.where(eq(agentSessions.terminalId, id))
				.run();
		const reporter = workspaceReporter("workspace", id);
		if (!reporter) throw Error("Missing reporter");
		getDb()
			.insert(agentMessages)
			.values({
				id: `question-${id}`,
				projectId: "project",
				fromWorkspaceId: "workspace",
				toWorkspaceId: null,
				kind: "question",
				reporter,
				content: "Which color should be used?",
				createdAt: new Date(),
			})
			.run();
	}
	setupTRPCIPC(router({ activityQueue: activityQueueRouter }));
	win = new BrowserWindow({
		show: false,
		width: 1100,
		height: 800,
		webPreferences: {
			preload: join(root, "preload.cjs"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
			backgroundThrottling: false,
		},
	});
	const contents = win.webContents;
	rendererTrust.register(contents.id, pathToFileURL(join(root, "index.html")).href);
	contents.on("before-input-event", (event) => event.preventDefault());
	await win.loadFile(join(root, "index.html"));
	win.show();
	app.focus({ steal: true });
	win.focus();
	contents.focus();
	const js = (code: string) => contents.executeJavaScript(code);
	const select = (id: string) => `document.querySelector('[data-terminal="${id}"]')`;
	const button = (id: string, label: string) =>
		`Array.from(${select(id)}.querySelectorAll('button')).find(b=>b.textContent===${JSON.stringify(label)})`;
	const enter = async (id: string) => {
		await until(() => js(`!!${select(id)}?.querySelector('textarea')`));
		await js(
			`(()=>{const el=${select(id)}.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,'Use blue');el.dispatchEvent(new Event('input',{bubbles:true}));})()`
		);
		await until(() =>
			js(`!!${button(id, "Send & continue")}&&!${button(id, "Send & continue")}.disabled`)
		);
		await js(`${button(id, "Send & continue")}.click()`);
	};
	const answer = (id: string) =>
		getDb()
			.select()
			.from(agentMessages)
			.where(eq(agentMessages.inReplyTo, `question-${id}`))
			.get();
	for (const id of ["claude-live", "codex-sleeping"]) {
		await enter(id);
		await until(() => writes.some((write) => write.id === id));
		const saved = answer(id);
		assert.ok(saved);
		assert.equal(saved.retrievedAt, null);
		assert.equal(writes.filter((write) => write.id === id).length, 1);
		const write = writes.find((write) => write.id === id);
		assert.ok(write);
		assert.equal(write.mode, id === "codex-sleeping" ? "resume" : "live");
		if (id === "codex-sleeping") {
			manager.handleAgentEvent({
				agent: "codex",
				sessionId: id,
				terminalId: id,
				workspaceId: "workspace",
				providerSessionId: `chat-${id}`,
				rawEvent: "SessionStart",
				alert: "active",
				sessionSource: "resume",
				timestamp: Date.now(),
				cwd: root,
			});
			assert.equal(answer(id)?.retrievedAt, null);
		}
		const accepted = manager.handleAgentEvent({
			agent: id === "claude-live" ? "claude" : "codex",
			sessionId: id,
			terminalId: id,
			workspaceId: "workspace",
			providerSessionId: `chat-${id}`,
			rawEvent: "UserPromptSubmit",
			alert: "active",
			turnId: `continued-${id}`,
			promptHash: createHash("sha256").update(write.content).digest("hex"),
			timestamp: Date.now() + 10,
			cwd: root,
		});
		assert.ok(accepted);
		await until(() => js(`!${select(id)}`));
		assert.ok(answer(id)?.retrievedAt);
		assert.equal(
			getDb()
				.select()
				.from(activityQueueDeliveries)
				.where(eq(activityQueueDeliveries.requestId, write.requestId))
				.get()?.continuationTurnId,
			`continued-${id}`
		);
	}
	assert.equal(answer("sibling"), undefined);
	assert.equal(
		writes.some((write) => write.id === "sibling"),
		false
	);
	await enter("busy");
	await until(() => !!answer("busy"));
	await until(() => js(`!!${button("busy", "Continue with saved answer")}`));
	assert.equal(
		writes.some((write) => write.id === "busy"),
		false
	);
	const savedId = answer("busy")?.id;
	assert.ok(savedId);
	busyBoundary = false;
	getDb()
		.update(agentSessions)
		.set({ state: "idle" })
		.where(eq(agentSessions.terminalId, "busy"))
		.run();
	await until(() => js(`!${button("busy", "Continue with saved answer")}.disabled`));
	await js(`${button("busy", "Continue with saved answer")}.click()`);
	await until(() => writes.some((write) => write.id === "busy"));
	assert.equal(answer("busy")?.id, savedId);
	assert.equal(
		getDb().select().from(agentMessages).where(eq(agentMessages.inReplyTo, "question-busy")).all()
			.length,
		1
	);
	await js("window.scrollTo(0,0)");
	writeFileSync(join(root, "answer-native.png"), (await contents.capturePage()).toPNG());
	writeFileSync(
		join(root, "result.json"),
		JSON.stringify(
			{
				native: true,
				productionRouter: true,
				connectedQuestionActions: true,
				realProviders: false,
				realPty: false,
				realSqlAdmission: true,
				liveAndResumeModes: true,
				exactDigestRetrieval: true,
				siblingIsolation: true,
				saveSurvivesDefiniteFailure: true,
				explicitRetryNoDuplicateAnswer: true,
				remainingQuestions: (await listWorkspaceQueue()).items.filter((item) => item.question)
					.length,
			},
			null,
			2
		)
	);
}
function finish(code: number) {
	manager.dispose();
	setDaemonClient(null);
	win?.destroy();
	setTimeout(() => app.exit(code), 100);
}
run()
	.then(() => finish(0))
	.catch((error) => {
		console.error(error);
		finish(1);
	});
