import { afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import type { Root } from "react-dom/client";
import {
	type OwnedChatTerminalActions,
	openOwnedChat,
} from "../src/renderer/lib/owned-chat-launch";
import type { OwnedChatLaunch, OwnedChatProvider } from "../src/shared/owned-chat";
const browser = new Window({ url: "http://localhost" });
for (const [key, value] of Object.entries({
	window: browser,
	document: browser.document,
	navigator: browser.navigator,
	HTMLElement: browser.HTMLElement,
	Node: browser.Node,
	Event: browser.Event,
	IS_REACT_ACT_ENVIRONMENT: true,
}))
	Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
const { createRoot } = await import("react-dom/client");
const { NewChatMenu } = await import("../src/renderer/components/panes/NewChatMenu");
let root: Root;
afterEach(async () => {
	await act(() => root?.unmount());
	document.body.innerHTML = "";
});
async function mount(startChat: (provider: OwnedChatProvider) => Promise<void>) {
	const host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	await act(() => root.render(<NewChatMenu startChat={startChat} />));
	return { render: () => act(() => root.render(<NewChatMenu startChat={startChat} />)) };
}
function button(label: string) {
	const found = Array.from(browser.document.querySelectorAll("button")).find(
		(b) => b.textContent === label || b.getAttribute("aria-label") === label
	);
	if (!found) throw Error(`Missing button: ${label}`);
	return found;
}
const launch: OwnedChatLaunch = {
	workspaceId: "folder-workspace",
	terminalId: "exact-new-chat",
	cwd: "/authoritative/folder",
	title: "Codex chat",
	scriptPath: "/tmp/owned'chat/launch.sh",
};
function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

test("provider selection is explicit and double clicks/rerenders launch only once", async () => {
	const pending = deferred();
	const calls: OwnedChatProvider[] = [];
	const mounted = await mount(async (provider) => {
		calls.push(provider);
		await pending.promise;
	});
	expect(calls).toEqual([]);
	await act(() => button("New agent chat").click());
	expect(document.querySelectorAll('[role="menuitem"]')).toHaveLength(2);
	expect(document.activeElement?.textContent).toBe("New Claude chat");
	await act(() => {
		button("New Claude chat").dispatchEvent(
			new browser.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })
		);
	});
	expect(document.activeElement?.textContent).toBe("New Codex chat");
	expect(calls).toEqual([]);
	await act(async () => {
		button("New Codex chat").click();
		button("New Claude chat").click();
		await Promise.resolve();
	});
	expect(calls).toEqual(["codex"]);
	await mounted.render();
	expect(calls).toEqual(["codex"]);
	await act(async () => {
		pending.resolve();
		await pending.promise;
	});
	expect(document.querySelector('[role="menu"]')).toBeNull();
	expect(calls).toEqual(["codex"]);
});

test("Escape closes without starting a chat and restores trigger focus", async () => {
	let calls = 0;
	await mount(async () => {
		calls++;
	});
	const trigger = button("New agent chat");
	await act(() => trigger.click());
	await act(() => {
		button("New Claude chat").dispatchEvent(
			new browser.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })
		);
	});
	expect(document.querySelector('[role="menu"]')).toBeNull();
	expect(browser.document.activeElement).toBe(trigger);
	expect(calls).toBe(0);
});

test("startup failure is visible and never causes an automatic retry", async () => {
	let calls = 0;
	const mounted = await mount(async () => {
		calls++;
		throw Error("synthetic startup failure");
	});
	await act(() => button("New agent chat").click());
	await act(async () => {
		button("New Claude chat").click();
		await Promise.resolve();
	});
	expect(document.querySelector('[role="alert"]')?.textContent).toContain("could not start");
	await mounted.render();
	await act(async () => {
		await Promise.resolve();
	});
	expect(calls).toBe(1);
	expect(button("New Claude chat").disabled).toBe(false);
});

test("new folder chat uses authoritative metadata and awaits creation before its one script write", async () => {
	const pending = deferred();
	const calls: string[] = [];
	const writes: string[] = [];
	const actions: OwnedChatTerminalActions = {
		activateWorkspace: (id, cwd) => calls.push(`activate:${id}:${cwd}`),
		addTerminal: (id, cwd, title, terminalId) => {
			calls.push(`tab:${id}:${cwd}:${title}:${terminalId}`);
			return terminalId;
		},
		createTerminal: async (id, cwd, owner) => {
			calls.push(`create:${id}:${cwd}:${owner}`);
			await pending.promise;
		},
		writeTerminal: async (id, text) => {
			calls.push(`write:${id}`);
			writes.push(text);
			return true;
		},
	};
	const done = openOwnedChat(launch, actions);
	expect(calls).toEqual([
		"activate:folder-workspace:/authoritative/folder",
		"tab:folder-workspace:/authoritative/folder:Codex chat:exact-new-chat",
		"create:exact-new-chat:/authoritative/folder:folder-workspace",
	]);
	expect(writes).toEqual([]);
	pending.resolve();
	await done;
	expect(writes).toEqual(["bash '/tmp/owned'\\''chat/launch.sh'\r"]);
	expect(calls.at(-1)).toBe("write:exact-new-chat");
});

test("failed create and changed tab identity prevent script delivery", async () => {
	for (const wrongTab of [false, true]) {
		let creates = 0;
		let writes = 0;
		await expect(
			openOwnedChat(launch, {
				activateWorkspace: () => {},
				addTerminal: () => (wrongTab ? "another-terminal" : launch.terminalId),
				createTerminal: async () => {
					creates++;
					throw Error("create failed");
				},
				writeTerminal: async () => {
					writes++;
					return true;
				},
			})
		).rejects.toThrow();
		expect(writes).toBe(0);
		expect(creates).toBe(wrongTab ? 0 : 1);
	}
});

test("known failed script admission is reported with no retry or replacement", async () => {
	let writes = 0;
	await expect(
		openOwnedChat(launch, {
			activateWorkspace: () => {},
			addTerminal: () => launch.terminalId,
			createTerminal: async () => {},
			writeTerminal: async () => {
				writes++;
				return false;
			},
		})
	).rejects.toThrow("startup was not sent");
	expect(writes).toBe(1);
});
