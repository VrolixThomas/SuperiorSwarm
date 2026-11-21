import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import type { BrowserWindow } from "electron";
import { listWorkspaceQueue } from "../../../src/main/activity-queue/workspace-queue";
import { getDb } from "../../../src/main/db";
import { agentMessages } from "../../../src/main/db/schema";
import { readMessages, sendMessage } from "../../../src/main/services/workspace-service";

/** Native renderer -> preload -> production tRPC -> durable inbox; no provider execution claimed. */
export async function checkQuestionInteractions(
	win: BrowserWindow,
	root: string,
	questionId: string
) {
	const contents = win.webContents;
	const js = <T = unknown>(code: string): Promise<T> => contents.executeJavaScript(code);
	const until = async (predicate: () => Promise<boolean>) => {
		for (let i = 0; i < 160; i++) {
			if (await predicate()) return;
			await new Promise((r) => setTimeout(r, 25));
		}
		throw Error("Question interaction timed out");
	};
	const click = (label: string) =>
		js(
			`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)}); if(!b)throw Error('Missing '+${JSON.stringify(label)});b.scrollIntoView({block:'nearest'});b.click();})()`
		);
	await js(`document.querySelector('[data-queue-row="agent-question:${questionId}"]').click()`);
	win.setContentSize(800, 600);
	await click("Details / reply");
	await until(() => js<boolean>("!!document.querySelector('#queue-question-answer')"));
	await js(
		"document.querySelector('#queue-question-answer').scrollIntoView({block:'center'}); document.querySelector('#queue-question-answer').focus()"
	);
	await contents.insertText("Use the exact reporting conversation. e h z are answer text.");
	if ((await listWorkspaceQueue()).totalPending !== 3)
		throw Error("Typing cleared queue attention");
	// Mutate between display and submit. The real backend refuses the displayed old receipt.
	getDb()
		.update(agentMessages)
		.set({ content: "Updated question: restore the exact reporting conversation?" })
		.where(eq(agentMessages.id, questionId))
		.run();
	await click("Send answer");
	await until(() => js<boolean>("document.body.textContent.includes('Your draft is preserved')"));
	if (
		!(await js<boolean>(
			"document.querySelector('#queue-question-answer').value.includes('exact reporting conversation')"
		))
	)
		throw Error("Conflict discarded draft");
	await contents
		.capturePage()
		.then((c) => writeFileSync(join(root, "queue-question-conflict.png"), c.toPNG()));
	await click("Use reviewed question revision");
	await click("Send answer");
	await until(() =>
		js<boolean>("document.body.textContent.includes('has not read this answer yet')")
	);
	await contents
		.capturePage()
		.then((c) => writeFileSync(join(root, "queue-question-saved.png"), c.toPNG()));
	// Open is view-only, and returning remounts the form with the persisted saved answer.
	await js(
		"[...document.querySelectorAll('[aria-label=\"Queue item details\"] button')].find(button=>button.textContent.startsWith('Open question')).click()"
	);
	await until(() =>
		js<boolean>("!!document.querySelector('[data-terminal-id=\"terminal-w1\"] textarea')")
	);
	if ((await listWorkspaceQueue()).totalPending !== 3)
		throw Error("Opening saved question consumed the answer");
	await click("Queue 3");
	await until(() => js<boolean>("!!document.querySelector('[data-queue-row]')"));
	await click("Details / reply");
	await until(() =>
		js<boolean>(
			"document.body.textContent.includes('Your answer: Use the exact reporting conversation')&&document.body.textContent.includes('has not read this answer yet')"
		)
	);
	const saved = (await listWorkspaceQueue()).items.find(
		(i) => i.question?.messageId === questionId
	);
	if (!saved?.question?.answer || saved.question.answer.delivery !== "saved")
		throw Error("Saved reply was removed before retrieval");
	const reply = getDb()
		.select()
		.from(agentMessages)
		.where(eq(agentMessages.id, saved.question.answer.messageId))
		.get();
	if (reply?.inReplyTo !== questionId || !reply.content.includes("exact reporting conversation"))
		throw Error("Reply correlation/content lost");
	// Sibling and no-terminal reads cannot impersonate the reporting conversation.
	const siblingInbox = await readMessages(
		{ kind: "workspace", projectId: "p1", workspaceId: "w1", terminalId: "sibling-w1" },
		{ includeBroadcasts: false }
	);
	if (siblingInbox.messages.some((message) => message.id === reply.id))
		throw Error("Sibling received exact reporter's answer");
	await readMessages(
		{ kind: "workspace", projectId: "p1", workspaceId: "w1" },
		{ includeBroadcasts: false }
	);
	if (!(await listWorkspaceQueue()).items.some((i) => i.question?.messageId === questionId))
		throw Error("Unidentified reader cleared exact question");
	const inbox = await readMessages(
		{ kind: "workspace", projectId: "p1", workspaceId: "w1", terminalId: "terminal-w1" },
		{ includeBroadcasts: false }
	);
	if (!inbox.messages.some((message) => message.id === reply.id))
		throw Error("Exact reporter did not receive correlated reply");
	if ((await listWorkspaceQueue()).items.some((i) => i.question?.messageId === questionId))
		throw Error("Retrieved question stayed pending");
	await click("Back to queue items");
	win.setContentSize(1440, 900);
	// Restore three independent pending items for the remaining error/recovery checks.
	await sendMessage(
		{ kind: "workspace", projectId: "p1", workspaceId: "w1", terminalId: "terminal-w1" },
		{
			kind: "question",
			content: "New independent question after the previous answer was retrieved.",
		}
	);
	await click("Refresh queue");
	await until(() => js<boolean>("document.querySelectorAll('[data-queue-row]').length===3"));
}
