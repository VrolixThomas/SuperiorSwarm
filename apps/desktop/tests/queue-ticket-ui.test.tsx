import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import type { ExternalQueueItem } from "../src/shared/activity-queue";

const browser = new Window({ url: "http://localhost" });
for (const [key, value] of Object.entries({
	window: browser,
	document: browser.document,
	navigator: browser.navigator,
	HTMLElement: browser.HTMLElement,
	Event: browser.Event,
	IS_REACT_ACT_ENVIRONMENT: true,
}))
	Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
const calls: { type: string; input: unknown }[] = [];
let prepareError = false;
let linkError = false;
const issue = {
	provider: "jira" as const,
	id: "SUP-39",
	identifier: "SUP-39",
	title: "Fix tickets",
	url: "https://a.atlassian.net/browse/SUP-39",
	status: { id: "todo", name: "Todo", color: "gray" },
	groupId: "SUP",
};
const target = {
	type: "ticket" as const,
	provider: "jira" as const,
	accountId: "me",
	siteId: "site-a",
	ticketId: issue.id,
	identifier: issue.identifier,
	url: issue.url,
	groupId: issue.groupId,
};
const noop = () => undefined;
const invalidate = async () => undefined;
const store = {
	setActiveWorkspace: noop,
	addTerminalTab: (_id: string, _cwd: string, _title: string, terminalId: string) => terminalId,
};
mock.module("../src/renderer/stores/tab-store", () => ({ useTabStore: { getState: () => store } }));
mock.module("../src/renderer/trpc/client", () => ({
	trpc: {
		useUtils: () => ({
			tickets: { getLinkedTickets: { invalidate } },
			workspaces: { listByProject: { invalidate } },
		}),
		activityQueue: {
			ticketPrepare: {
				useMutation: () => ({
					isPending: false,
					mutateAsync: async (input: unknown) => {
						calls.push({ type: "prepare", input });
						if (prepareError) throw Error("This occurrence changed");
						return { target, issue, settings: { defaultAgent: "codex" as const, showAll: false } };
					},
				}),
			},
		},
		projects: {
			list: {
				useQuery: () => ({
					data: [
						{ id: "repo", name: "Repo", kind: "repo", status: "ready", repoPath: "/tmp/repo" },
					],
				}),
			},
		},
		branches: { list: { useQuery: () => ({ data: [{ name: "main" }], isPending: false }) } },
		tickets: {
			linkTicket: {
				useMutation: () => ({
					mutate: noop,
					mutateAsync: async (input: unknown) => {
						calls.push({ type: "link", input });
						if (linkError) throw Error("Link could not be saved");
					},
				}),
			},
		},
		agentLaunch: {
			startChat: {
				useMutation: () => ({
					mutateAsync: async (input: unknown) => {
						calls.push({ type: "launch", input });
						return {
							workspaceId: "new-workspace",
							terminalId: "new-chat",
							cwd: "/tmp/worktree",
							title: "Codex",
							scriptPath: "/tmp/launch.sh",
						};
					},
				}),
			},
		},
		workspaces: {
			attachTerminal: { useMutation: () => ({ mutate: noop }) },
			create: {
				useMutation: (options: { onSuccess: (value: unknown) => Promise<void> }) => ({
					reset: noop,
					isPending: false,
					isError: false,
					mutate: async (input: unknown) => {
						calls.push({ type: "create", input });
						await options.onSuccess({ id: "new-workspace", name: "feature/SUP-39" });
					},
				}),
			},
		},
	},
}));
Object.assign(browser, {
	electron: {
		shell: {
			openExternal: async (url: string) => {
				calls.push({ type: "open", input: url });
			},
		},
		terminal: {
			create: async (...input: unknown[]) => {
				calls.push({ type: "terminal-create", input });
			},
			write: async (...input: unknown[]) => {
				calls.push({ type: "terminal-write", input });
				return true;
			},
		},
	},
});
const { createRoot } = await import("react-dom/client");
const { QueueTicketActions } = await import("../src/renderer/components/queue/QueueTicketActions");
let root: Root;
let refreshes = 0;
const item = {
	id: "ticket:jira:me:site-a:SUP-39",
	revision: 2,
	kind: "ticket-start",
	category: "tickets",
	target,
	stale: false,
} as ExternalQueueItem;
beforeEach(() => {
	calls.length = 0;
	prepareError = false;
	linkError = false;
	refreshes = 0;
});
afterEach(async () => {
	await act(() => root?.unmount());
	document.body.innerHTML = "";
});
async function mount() {
	const host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	await act(() =>
		root.render(
			<QueueTicketActions
				item={item}
				refresh={async () => {
					refreshes++;
				}}
			/>
		)
	);
}
async function click(label: string) {
	const button = [...document.querySelectorAll("button")].find(
		(button) => button.textContent?.trim() === label
	);
	if (!button) throw Error(`Missing ${label}`);
	await act(async () => {
		button.click();
		await Promise.resolve();
	});
}
async function confirm() {
	const form = document.querySelector("form");
	if (!form) throw Error("Missing confirmation form");
	await act(async () => {
		form.dispatchEvent(
			new browser.Event("submit", { bubbles: true, cancelable: true }) as unknown as Event
		);
		await new Promise((resolve) => setTimeout(resolve, 5));
	});
}
test("Open validates exact receipt and opens ticket without creating or acknowledging", async () => {
	await mount();
	await click("Open ticket");
	expect(calls).toEqual([
		{ type: "prepare", input: { id: item.id, revision: 2, action: "open" } },
		{ type: "open", input: issue.url },
	]);
	expect(document.querySelector("form")).toBeNull();
});
test("Start waits for confirmation then links exact site and starts contextual default agent once", async () => {
	await mount();
	await click("Start work…");
	expect(calls.map((call) => call.type)).toEqual(["prepare"]);
	expect(document.body.textContent).toContain("Fix tickets");
	expect(document.body.textContent).toContain("Codex after you confirm");
	await confirm();
	expect(calls.map((call) => call.type)).toEqual([
		"prepare",
		"create",
		"link",
		"launch",
		"terminal-create",
		"terminal-write",
	]);
	expect(calls.find((call) => call.type === "create")?.input).toMatchObject({
		queueTicket: { id: item.id, revision: 2 },
		projectId: "repo",
	});
	expect(calls.find((call) => call.type === "link")?.input).toMatchObject({
		queueAccount: { accountId: "me", siteId: "site-a" },
		workspaceId: "new-workspace",
	});
	expect(calls.find((call) => call.type === "launch")?.input).toMatchObject({
		provider: "codex",
		initialPrompt: expect.stringContaining("Start work on SUP-39: Fix tickets"),
	});
	expect(refreshes).toBe(1);
});
test("failed link never starts agent or retries creation; occurrence conflict refreshes", async () => {
	await mount();
	await click("Start work…");
	linkError = true;
	await confirm();
	expect(calls.some((call) => call.type === "launch")).toBe(false);
	expect(document.body.textContent).toContain("Link could not be saved");
	await confirm();
	expect(calls.filter((call) => call.type === "create")).toHaveLength(1);
});
test("stale occurrence does not open confirmation or create work", async () => {
	prepareError = true;
	await mount();
	await click("Start work…");
	expect(document.querySelector("form")).toBeNull();
	expect(refreshes).toBe(1);
	expect(calls.map((call) => call.type)).toEqual(["prepare"]);
	expect(document.body.textContent).toContain("This occurrence changed");
});
