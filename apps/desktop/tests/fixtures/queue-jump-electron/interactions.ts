import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import type { BrowserWindow } from "electron";
import {
	bringBack,
	later,
	listWorkspaceQueue,
} from "../../../src/main/activity-queue/workspace-queue";
import { getDb } from "../../../src/main/db";
import {
	agentMessages,
	crossRepoOrchestrators,
	terminalSessions,
	ticketCache,
} from "../../../src/main/db/schema";
import type { AgentSessionManager } from "../../../src/main/services/agent-session-manager";
import { readMessages, setStatus } from "../../../src/main/services/workspace-service";
import type { DaemonClient } from "../../../src/main/terminal/daemon-client";

/** Actual Chromium + xterm + IPC + SQLite + PTYs; provider state is a labeled stand-in. */
export async function checkJumpInteractions(
	win: BrowserWindow,
	root: string,
	daemon: DaemonClient,
	manager: AgentSessionManager,
	questionId: string
) {
	const web = win.webContents;
	const js = <T = unknown>(code: string): Promise<T> => web.executeJavaScript(code);
	let step = "initial queue";
	const until = async (predicate: () => Promise<boolean>) => {
		for (let i = 0; i < 480; i++) {
			if (await predicate()) return;
			await new Promise((r) => setTimeout(r, 25));
		}
		await web.capturePage().then((c) => writeFileSync(join(root, "failure.png"), c.toPNG()));
		throw Error(`${step}: ${await js("document.body.innerText")}`);
	};
	const check = (value: unknown, message: string) => {
		if (!value) throw Error(message);
	};
	const click = (label: string) =>
		js(
			`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)});if(!b)throw Error('Missing button '+${JSON.stringify(label)});b.click();})()`
		);
	const key = (keyCode: string, modifiers: ("meta" | "ctrl" | "shift")[] = []) => {
		web.sendInputEvent({ type: "keyDown", keyCode, modifiers });
		web.sendInputEvent({ type: "keyUp", keyCode, modifiers });
	};
	const refresh = () => js("window.queueFixture.refresh()");
	const current = () =>
		js<{
			workspace: string;
			terminal: string;
			session: { item: { id: string; revision: number } };
		}>("window.queueFixture.state()");
	await until(() => js<boolean>("document.querySelectorAll('[data-queue-row]').length===3"));
	check(
		await js<boolean>(
			"document.querySelector('[aria-label=\"Queue item details\"]').textContent.includes('SUP-46') && document.querySelector('[aria-label=\"Queue item details\"]').textContent.includes('Exact queue navigation')"
		),
		"QueuePanel missed explicit linked work"
	);
	const before = await listWorkspaceQueue();
	const inventory = await daemon.listSessionsStrict();
	let creates = 0;
	let writes = 0;
	const originalCreate = daemon.create.bind(daemon);
	const originalWrite = daemon.write.bind(daemon);
	daemon.create = (...args: Parameters<DaemonClient["create"]>) => {
		creates++;
		return originalCreate(...args);
	};
	daemon.write = (...args: Parameters<DaemonClient["write"]>) => {
		writes++;
		return originalWrite(...args);
	};
	step = "first jump";
	key("j", ["meta"]);
	await until(() =>
		js<boolean>(
			"!!document.querySelector('[aria-label=\"Queue navigation\"]') && window.queueFixture.state().terminal==='terminal-w1'"
		)
	);
	await until(() =>
		js<boolean>(
			"!!document.querySelector('[data-terminal-id=\"terminal-w1\"] .xterm-helper-textarea')"
		)
	);
	check(
		(await listWorkspaceQueue()).items.map((i) => `${i.id}:${i.revision}`).join() ===
			before.items.map((i) => `${i.id}:${i.revision}`).join(),
		"Jump mutated receipts"
	);
	check(creates === 0, "Jump created a replacement terminal");
	await js(
		"document.querySelector('[data-terminal-id=\"terminal-w1\"] .xterm-helper-textarea').focus()"
	);
	await until(() =>
		js<boolean>("!!document.querySelector('[data-queue-header] [aria-label=\"Linked work\"]')")
	);
	await js("document.querySelector('[data-queue-header] summary').click()");
	await until(() =>
		js<boolean>("document.querySelector('[data-queue-header] details')?.open===true")
	);
	await new Promise((r) => setTimeout(r, 100));
	check(
		await js<boolean>(
			`(()=>{const panel=document.querySelector('[data-queue-header] details > div');const r=panel.getBoundingClientRect();return r.width>0&&r.height>0&&r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&panel.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})()`
		),
		"Linked header popover clipped or obscured"
	);

	check(
		await js<boolean>(
			"document.querySelector('[data-queue-header]').textContent.includes('SUP-46') && document.querySelector('[data-queue-header]').textContent.includes('Exact queue navigation')"
		),
		"Header missed explicit links"
	);
	await web.capturePage().then((c) => writeFileSync(join(root, "header-links.png"), c.toPNG()));
	await js(
		"document.querySelector('[data-queue-header] summary').click(); document.querySelector('[data-terminal-id=\"terminal-w1\"] .xterm-helper-textarea').focus()"
	);
	check(
		await js<boolean>(
			"document.querySelector('[aria-label=\"Queue navigation\"]').getBoundingClientRect().height <= 80"
		),
		"Collapsed queue bar is not compact"
	);
	step = "terminal origin peek";
	key("j", ["meta", "shift"]);
	await until(() => js<boolean>("!!document.querySelector('[aria-label=\"Queue peek\"]')"));
	check(
		await js<boolean>(
			"document.querySelector('[aria-label=\"Queue peek\"]').contains(document.activeElement)"
		),
		"Peek failed to own focus"
	);
	check(
		await js<boolean>(
			"document.querySelector('[aria-label=\"Queue peek\"]').textContent.includes('SUP-46')"
		),
		"Peek missed exact linked ticket"
	);
	const ticketId = "11111111-1111-4111-8111-111111111111";
	getDb()
		.update(ticketCache)
		.set({
			data: JSON.stringify({ id: ticketId, identifier: "SUP-46", title: "Refreshed linked title" }),
		})
		.where(eq(ticketCache.id, `linear:${ticketId}`))
		.run();
	await refresh();
	check(
		(await listWorkspaceQueue()).items.map((i) => `${i.id}:${i.revision}`).join() ===
			before.items.map((i) => `${i.id}:${i.revision}`).join(),
		"Metadata refresh changed receipts"
	);
	for (const [width, height] of [
		[1440, 900],
		[800, 600],
	]) {
		win.setContentSize(width ?? 800, height ?? 600);
		await new Promise((r) => setTimeout(r, 120));
		check(
			await js<boolean>(
				"(()=>{const r=document.querySelector('[aria-label=\"Queue peek\"]').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&document.documentElement.scrollWidth<=innerWidth})()"
			),
			"Peek clipped or overflowed"
		);

		check(
			await js<boolean>(
				`(()=>{const panel=document.querySelector('[aria-label="Queue peek"]');const top=panel.getBoundingClientRect().top;return [...panel.querySelectorAll('[data-queue-row]')].every(row=>{const r=row.getBoundingClientRect();return r.height>=40&&r.top>=top&&r.bottom<=innerHeight})})()`
			),
			"Peek rows collapsed or hidden at responsive size"
		);
		await web.capturePage().then((c) => writeFileSync(join(root, `peek-${width}.png`), c.toPNG()));
	}
	await js(`document.querySelector('[aria-label="Queue peek"] textarea').focus()`);
	await web.insertText("e h z should remain answer text");
	check((await listWorkspaceQueue()).totalPending === 3, "Typing consumed attention");
	check(writes === 0, "Peek typing wrote to a shell");
	key("Escape");
	await until(() => js<boolean>("!document.querySelector('[aria-label=\"Queue peek\"]')"));
	check(
		await js<boolean>(
			"document.activeElement?.closest('[data-terminal-id]')?.getAttribute('data-terminal-id')==='terminal-w1'"
		),
		"Escape did not restore terminal focus"
	);
	step = "sibling isolation";
	await js("window.queueFixture.selectSibling()");
	await until(() => js<boolean>("!document.querySelector('[aria-label=\"Queue navigation\"]')"));
	await js("window.queueFixture.selectReporter()");
	await until(() => js<boolean>("!!document.querySelector('[aria-label=\"Queue navigation\"]')"));
	step = "header opens matching pending items";
	await click("1 in the queue");
	await until(() => js<boolean>("!!document.querySelector('[aria-label=\"Queue peek\"]')"));
	check(
		(await js<number>(
			"document.querySelectorAll('[aria-label=\"Queue peek\"] [data-queue-row]').length"
		)) === 1,
		"Header mixed sibling workspaces"
	);
	key("Escape");
	step = "updated occurrence blocks old actions";
	getDb()
		.update(agentMessages)
		.set({ content: "Updated native question" })
		.where(eq(agentMessages.id, questionId))
		.run();
	// Background polling must discover this without a user Refresh gesture.
	await until(() =>
		js<boolean>(
			"document.querySelector('[aria-label=\"Queue navigation\"]')?.textContent.includes('Updated')??false"
		)
	);
	check(
		await js<boolean>(
			"document.querySelector('[aria-label=\"Queue navigation\"] [data-queue-done]').disabled"
		),
		"Updated bar retained old action"
	);
	key("j", ["meta"]);
	await until(
		async () =>
			(await current()).session.item.revision >
			(before.items.find((i) => i.id === `agent-question:${questionId}`)?.revision ?? 0)
	);
	step = "native correlated answer and exact receiver";
	await click("Details / reply");
	await js("document.querySelector('[aria-label=\"Queue navigation\"] textarea').focus()");
	await web.insertText("Exact native answer");
	await click("Send answer");
	await until(() =>
		js<boolean>("document.body.textContent.includes('has not read this answer yet')")
	);
	const saved = getDb()
		.select()
		.from(agentMessages)
		.all()
		.find((m) => m.inReplyTo === questionId && m.kind === "answer");
	check(saved?.content === "Exact native answer", "Native answer not saved exactly");
	const sibling = await readMessages(
		{ kind: "workspace", projectId: "p1", workspaceId: "w1", terminalId: "sibling-w1" },
		{ includeBroadcasts: false }
	);
	check(!sibling.messages.some((m) => m.id === saved?.id), "Sibling retrieved bound answer");
	const exact = await readMessages(
		{ kind: "workspace", projectId: "p1", workspaceId: "w1", terminalId: "terminal-w1" },
		{ includeBroadcasts: false }
	);
	check(
		exact.messages.some((m) => m.id === saved?.id),
		"Exact recipient did not retrieve answer"
	);
	await refresh();
	await until(() =>
		js<boolean>(
			"document.querySelector('[aria-label=\"Queue navigation\"]')?.textContent.includes('Cleared')??false"
		)
	);
	step = "resolved current retains shifted successor";
	key("j", ["ctrl"]);
	await until(async () => (await current()).terminal === "terminal-w3");
	key("j", ["meta"]);
	await until(async () => (await current()).terminal === "terminal-w2");
	const grouped = (await listWorkspaceQueue()).items.find((i) => i.context.workspaceId === "w2");
	check((grouped?.members?.length ?? 0) > 1, "Missing grouped receipt fixture");
	await click("Done");
	await until(() =>
		js<boolean>(
			"document.querySelector('[aria-label=\"Queue navigation\"]')?.textContent.includes('Cleared')??false"
		)
	);
	check(
		!(await listWorkspaceQueue()).items.some((i) => i.context.workspaceId === "w2"),
		"Done dropped member receipts"
	);
	key("j", ["meta"]);
	await until(() => js<boolean>('document.body.textContent.includes("That\'s everything.")'));
	check((await current()).terminal === "terminal-w2", "End wrapped");
	await click("Undo");
	await until(async () =>
		(await listWorkspaceQueue()).items.some((i) => i.context.workspaceId === "w2")
	);
	await click("Later");
	await click("Until it changes");
	await until(async () => (await listWorkspaceQueue()).laterCount === 1);
	key("j", ["meta"]);
	await new Promise((r) => setTimeout(r, 100));
	check((await current()).terminal === "terminal-w2", "Next included Later or wrapped");

	// Timed Later expiry returns through the canonical background query without navigation.
	check(grouped, "Missing grouped item");
	if (grouped) {
		await bringBack(grouped);
		await later({ ...grouped, until: Date.now() + 2000, untilChange: false });
		await refresh();
		await until(() =>
			js<boolean>(
				"document.querySelector('[aria-label=\"Queue navigation\"]')?.textContent.includes('Cleared')??false"
			)
		);
		await until(() =>
			js<boolean>(
				"document.querySelector('[aria-label=\"Queue navigation\"]')?.querySelector('[data-queue-done]')?.disabled===false"
			)
		);
		check((await current()).terminal === "terminal-w2", "Expiry auto-advanced user");
	}
	check(creates === 0, "Navigation created replacement shell");
	check(writes === 0, "Queue navigation or reply wrote PTY input");
	check(
		(await daemon.listSessionsStrict())
			.map((s) => s.id)
			.sort()
			.join() ===
			inventory
				.map((s) => s.id)
				.sort()
				.join(),
		"Navigation changed terminal inventory"
	);
	await web.capturePage().then((c) => writeFileSync(join(root, "bar-cleared.png"), c.toPNG()));

	step = "coordinator native navigation";
	const workDir = join(root, "coordinator");
	mkdirSync(workDir);
	const now = new Date();
	getDb()
		.insert(crossRepoOrchestrators)
		.values({
			id: "xro-native",
			name: "Native coordinator",
			workDir,
			agentKind: "codex",
			sortOrder: 0,
			createdAt: now,
			updatedAt: now,
		})
		.run();
	getDb()
		.insert(terminalSessions)
		.values({
			id: "coordinator-chat",
			workspaceId: "xro-native",
			cwd: workDir,
			title: "Coordinator",
			sortOrder: 0,
			updatedAt: now,
		})
		.run();
	await originalCreate(
		"coordinator-chat",
		workDir,
		() => {},
		() => {},
		{ SHELL: "/bin/sh", HOME: root }
	);
	manager.registerManagedSession({
		terminalId: "coordinator-chat",
		workspaceId: "xro-native",
		provider: "codex",
		providerSessionId: "coordinator-conversation",
		skipPermissions: false,
	});
	await setStatus(
		{ kind: "xro", xroId: "xro-native", linkedProjectIds: ["p1"], terminalId: "coordinator-chat" },
		{ phase: "blocked", needs: "Choose exact coordinator task" }
	);
	await js(`window.queueFixture.addCoordinator(${JSON.stringify(workDir)})`);
	await refresh();
	key("j", ["meta", "shift"]);
	await until(() => js<boolean>("!!document.querySelector('[aria-label=\"Queue peek\"]')"));
	const coordinator = (await listWorkspaceQueue()).items.find(
		(i) => i.context.entity?.kind === "coordinator"
	);
	check(coordinator, "Missing coordinator row");
	await js(
		`document.querySelector('[aria-label="Queue peek"] [data-queue-row="${coordinator?.id}"]').click()`
	);
	key("Enter");
	await until(async () => (await current()).terminal === "coordinator-chat");
	await until(() => js<boolean>("!!document.querySelector('[aria-label=\"Queue navigation\"]')"));
	await until(() =>
		js<boolean>(
			"document.activeElement?.closest('[data-terminal-id]')?.getAttribute('data-terminal-id')==='coordinator-chat'"
		)
	);
	check(
		(await listWorkspaceQueue()).items.some((i) => i.id === coordinator?.id),
		"Coordinator open acknowledged"
	);
	check(creates === 0 && writes === 0, "Coordinator navigation injected input or replaced shell");
	await web.capturePage().then((c) => writeFileSync(join(root, "coordinator-bar.png"), c.toPNG()));

	manager.registerManagedSession({
		terminalId: "coordinator-chat",
		workspaceId: "xro-native",
		provider: "codex",
		providerSessionId: "replacement-conversation",
		skipPermissions: false,
	});
	await refresh();
	await until(() => js<boolean>("!document.querySelector('[aria-label=\"Queue navigation\"]')"));
	check(creates === 0 && writes === 0, "Replaced conversation inherited bar actions");
	writeFileSync(
		join(root, "result.json"),
		JSON.stringify(
			{
				jump: true,
				peek: true,
				receipts: true,
				noShellReplacement: true,
				providerEvidence: "stand-in",
				creates,
				writes,
				structuredAnswer: "saved and retrieved by exact inbox",
			},
			null,
			2
		)
	);
}
