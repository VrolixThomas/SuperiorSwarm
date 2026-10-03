import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { type TerminalFileBatch, formatFilePaths } from "../src/shared/terminal-files";
const dom = new Window();
Object.assign(globalThis, {
	window: dom,
	document: dom.document,
	navigator: dom.navigator,
	HTMLElement: dom.HTMLElement,
	MutationObserver: dom.MutationObserver,
	ResizeObserver: class {
		observe() {}
		disconnect() {}
	},
	getComputedStyle: dom.getComputedStyle.bind(dom),
	requestAnimationFrame: () => 1,
	cancelAnimationFrame: () => {},
	IS_REACT_ACT_ENVIRONMENT: true,
});
afterAll(() => dom.close());
beforeEach(() => {
	window.localStorage.clear();
	atomicSubmit = true;
});
let terminal: FakeTerminal;
class FakeTerminal {
	textarea = document.createElement("textarea");
	buffer = { active: { type: "normal" } };
	options = {};
	unicode = { activeVersion: "" };
	cols = 80;
	rows = 24;
	data: (text: string) => void = () => {};
	key: (event: KeyboardEvent) => boolean = () => true;
	constructor() {
		terminal = this;
	}
	loadAddon() {}
	open(element: HTMLElement) {
		element.append(this.textarea);
		this.textarea.addEventListener("keydown", (event) => {
			if (this.key(event) && event.key === "Enter") this.data("\r");
		});
	}
	refresh() {}
	write(_text: string, done?: () => void) {
		done?.();
	}
	dispose() {}
	onTitleChange() {}
	onResize() {}
	focus() {
		this.textarea.focus();
		this.data("\x1b[I");
	}
	paste(text: string) {
		this.data(`\x1b[200~${text}\x1b[201~`);
	}
	onData(fn: (text: string) => void) {
		this.data = fn;
	}
	attachCustomKeyEventHandler(fn: (event: KeyboardEvent) => boolean) {
		this.key = fn;
	}
}
mock.module("@xterm/xterm", () => ({ Terminal: FakeTerminal }));
for (const [module, name] of [
	["clipboard", "ClipboardAddon"],
	["fit", "FitAddon"],
	["image", "ImageAddon"],
	["search", "SearchAddon"],
	["unicode11", "Unicode11Addon"],
	["web-links", "WebLinksAddon"],
	["webgl", "WebglAddon"],
])
	mock.module(`@xterm/addon-${module}`, () => ({
		[name as string]: class {
			fit() {}
			dispose() {}
			onContextLoss() {}
		},
	}));
let selected: TerminalFileBatch;
let nextId = 0;
let atomicSubmit = true;
const ordinary: string[] = [];
const copied: string[] = [];
Object.defineProperty(navigator.clipboard, "writeText", {
	value: async (text: string) => {
		copied.push(text);
	},
});
const submitted: Array<{ payload: string; submit?: boolean }> = [];
const entries = (paths: Array<string | null>) =>
	paths.map((path) => ({
		id: String(nextId++),
		label: path?.split("/").at(-1) ?? "Virtual file",
		path,
		size: 10,
		kind: "file" as const,
		external: true,
		symlink: false,
		referenceAllowed: Boolean(path),
		copyAllowed: true,
	}));
mock.module("../src/renderer/trpc/client", () => ({
	trpcVanilla: {
		terminalFiles: {
			prepare: {
				mutate: async ({ paths }: { paths: Array<string | null> }) => {
					selected = {
						id: "batch",
						target: { terminalId: "t1", workspaceId: "ws", generation: "g1", root: "/fixture" },
						entries: entries(paths),
					};
					return structuredClone(selected);
				},
			},
			append: {
				mutate: async ({
					paths,
					retainedIds,
				}: { paths: Array<string | null>; retainedIds: string[] }) => {
					selected = {
						...selected,
						entries: [
							...selected.entries.filter((e) => retainedIds.includes(e.id)),
							...entries(paths),
						],
					};
					return structuredClone(selected);
				},
			},
			copyPaths: {
				mutate: async ({ ids }: { ids: string[] }) =>
					formatFilePaths(
						selected.entries.filter((e) => ids.includes(e.id)).map((e) => e.path as string)
					),
			},
			resolve: {
				mutate: async ({ ids }: { ids: string[] }) => ({
					text: formatFilePaths(
						selected.entries.filter((e) => ids.includes(e.id)).map((e) => e.path as string)
					),
					target: selected.target,
					submit: atomicSubmit,
				}),
			},
			insert: {
				mutate: async (value: { payload: string; submit?: boolean }) => {
					submitted.push(value);
					return "admitted";
				},
			},
			cancel: { mutate: async () => {} },
		},
	},
}));
const { Terminal } = await import("../src/renderer/components/Terminal");
let root: Root | undefined;
let host: HTMLDivElement;
afterEach(async () => {
	await act(async () => root?.unmount());
	host?.remove();
	root = undefined;
});
async function mount() {
	ordinary.length = 0;
	submitted.length = 0;
	Object.assign(window, {
		electron: {
			shell: { openExternal: async () => {} },
			terminalFiles: {
				nativePaths: (files: File[]) => files.map((file) => `/fixture/${file.name}`),
			},
			daemon: { onStatus: () => () => {} },
			terminal: {
				create: async () => ({ wasAttached: false }),
				setVisible: async () => {},
				detach: async () => {},
				resize: async () => {},
				onData: () => () => {},
				onExit: () => () => {},
				write: async (_id: string, data: string) => {
					ordinary.push(data);
					return true;
				},
			},
		},
	});
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	await act(async () => root?.render(<Terminal id="t1" workspaceId="ws" active={true} />));
}
async function drop(name: string) {
	const event = new dom.Event("drop", { bubbles: true, cancelable: true });
	Object.defineProperty(event, "dataTransfer", {
		value: { types: ["Files"], files: [new File(["generated fixture"], name)], items: [] },
	});
	await act(async () => {
		terminal.textarea.dispatchEvent(event as unknown as Event);
	});
	expect(event.defaultPrevented).toBe(true);
}
async function enter(shiftKey = false) {
	await act(async () => {
		terminal.textarea.dispatchEvent(
			new dom.KeyboardEvent("keydown", {
				key: "Enter",
				shiftKey,
				bubbles: true,
				cancelable: true,
			}) as unknown as KeyboardEvent
		);
	});
}
test("drop adds removable chips; the next Enter sends the surviving files with the existing draft", async () => {
	await mount();
	terminal.data("what files did I link?");
	await drop("first.pdf");
	await drop("second.mov");
	expect(host.textContent).toContain("first.pdf");
	expect(host.textContent).toContain("second.mov");
	expect(host.textContent).toContain("2 files added");
	expect(ordinary).toEqual(["what files did I link?"]);
	expect(submitted).toEqual([]);
	await act(async () => {
		(host.querySelector('[aria-label="Remove first.pdf"]') as HTMLButtonElement).click();
	});
	expect(host.textContent).not.toContain("first.pdf");
	await enter();
	expect(ordinary).toEqual(["what files did I link?"]);
	expect(submitted).toMatchObject([
		{ payload: "\x1b[200~ '/fixture/second.mov' \x1b[201~", submit: true },
	]);
	expect(document.activeElement === terminal.textarea).toBe(true);
});
test("details stay collapsed by default; removing all files restores ordinary Enter and Shift+Enter stays unchanged", async () => {
	await mount();
	await drop("example.pdf");
	expect(host.textContent).not.toContain("/fixture/example.pdf");
	await act(async () => {
		(host.querySelector('[aria-label="Details for example.pdf"]') as HTMLButtonElement).click();
	});
	expect(host.textContent).toContain("/fixture/example.pdf");
	expect(host.textContent).not.toContain("Copy into workspace");
	expect(host.textContent).not.toContain("Saved copies");
	await enter(true);
	expect(ordinary).toEqual(["\x1b[13;2u"]);
	expect(submitted).toEqual([]);
	terminal.data("next line");
	await act(async () => {
		(host.querySelector('[aria-label="Remove example.pdf"]') as HTMLButtonElement).click();
	});
	await enter();
	expect(ordinary.at(-1)).toBe("\r");
	expect(submitted).toEqual([]);
});

test("holding Enter after a successful file send cannot forward a second submit", async () => {
	await mount();
	await drop("once.pdf");
	await enter();
	await act(async () => {
		terminal.textarea.dispatchEvent(
			new dom.KeyboardEvent("keydown", {
				key: "Enter",
				repeat: true,
				bubbles: true,
				cancelable: true,
			}) as unknown as KeyboardEvent
		);
	});
	expect(submitted).toHaveLength(1);
	expect(ordinary).toEqual([]);
});

test("a rejected file-picker addition keeps the earlier file chips", async () => {
	await mount();
	await drop("keep.pdf");
	window.electron.terminalFiles.nativePaths = () => {
		throw new Error("Cannot add this file");
	};
	const input = host.querySelector('input[type="file"]') as HTMLInputElement;
	Object.defineProperty(input, "files", { value: [new File([], "invalid")], configurable: true });
	await act(async () => {
		input.dispatchEvent(new dom.Event("change", { bubbles: true }) as unknown as Event);
	});
	expect(host.textContent).toContain("keep.pdf");
	expect(host.textContent).toContain("Cannot add this file");
});

test("a new Enter press is not swallowed when keyup was lost after the file send", async () => {
	await mount();
	await drop("once.pdf");
	await enter();
	await enter();
	expect(submitted).toHaveLength(1);
	expect(ordinary).toEqual(["\r"]);
});

test("refresh keeps selected file chips without automatically submitting or reusing the old batch", async () => {
	window.localStorage.clear();
	await mount();
	await drop("kept-on-refresh.pdf");
	await act(async () => root?.unmount());
	host.remove();
	root = undefined;
	await mount();
	expect(host.textContent).toContain("kept-on-refresh.pdf");
	expect(submitted).toEqual([]);
	await enter();
	expect(submitted).toHaveLength(1);
});
test("choosing a local file returns focus to the terminal so Enter can send", async () => {
	window.localStorage.clear();
	await mount();
	const picker = host.querySelector('input[type="file"]') as HTMLInputElement;
	(host.querySelector("button") as HTMLButtonElement).focus();
	Object.defineProperty(picker, "files", {
		value: [new File([], "chosen.pdf")],
		configurable: true,
	});
	await act(async () => {
		picker.dispatchEvent(new dom.Event("change", { bubbles: true }) as unknown as Event);
	});
	expect(document.activeElement === terminal.textarea).toBe(true);
	expect(ordinary).toEqual([]);
});

test("pasting multiline draft text keeps the selected files and preserves ordinary paste bytes", async () => {
	await mount();
	await drop("kept.pdf");
	const text = "\x1b[200~review these\nplease\x1b[201~";
	await act(async () => {
		terminal.data(text);
	});
	expect(host.textContent).toContain("kept.pdf");
	expect(ordinary).toEqual([text]);
	expect(submitted).toEqual([]);
	await enter();
	expect(submitted).toHaveLength(1);
});
test("removing a file restores composer focus without emitting terminal focus bytes", async () => {
	await mount();
	await drop("first.pdf");
	await drop("second.pdf");
	const remove = host.querySelector('[aria-label="Remove first.pdf"]') as HTMLButtonElement;
	remove.focus();
	await act(async () => remove.click());
	expect(document.activeElement === terminal.textarea).toBe(true);
	expect(ordinary).toEqual([]);
});

test("the observed older daemon flow adds paths on Enter and permits the next Enter to send normally", async () => {
	atomicSubmit = false;
	await mount();
	await drop("legacy.pdf");
	terminal.data("review this");
	await enter();
	expect(host.textContent).toContain("Press Enter again");
	expect(ordinary).toEqual(["review this"]);
	await enter();
	expect(ordinary).toEqual(["review this", "\r"]);
	expect(submitted).toHaveLength(1);
});
test("refresh after an attempted delivery cannot restore a send intent or duplicate file input", async () => {
	await mount();
	await drop("sent.pdf");
	await enter();
	await act(async () => root?.unmount());
	host.remove();
	root = undefined;
	await mount();
	expect(host.textContent).not.toContain("sent.pdf");
	expect(submitted).toEqual([]);
});

test("manual Copy paths preserves the draft, restores focus, and leaves the user's next Enter untouched", async () => {
	await mount();
	copied.length = 0;
	terminal.data("review these ");
	await drop("first.pdf");
	await drop("second.mov");
	const button = [...host.querySelectorAll("button")].find(
		(button) => button.textContent === "Copy paths"
	);
	expect(Boolean(button)).toBe(true);
	button!.focus();
	await act(async () => button!.click());
	expect(copied).toEqual([" '/fixture/first.pdf' '/fixture/second.mov' "]);
	expect(ordinary).toEqual(["review these "]);
	expect(submitted).toEqual([]);
	expect(document.activeElement === terminal.textarea).toBe(true);
	expect(host.querySelector('[aria-label="Files in this message"]')).toBeNull();
	expect(host.textContent).toContain("Paste into the prompt");
	await enter();
	expect(ordinary).toEqual(["review these ", "\r"]);
	expect(submitted).toEqual([]);
});
