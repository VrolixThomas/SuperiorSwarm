import { expect, mock, test } from "bun:test";
import { inIsolatedFileBrowserTest } from "./helpers/isolated-file-browser-test";

if (inIsolatedFileBrowserTest(import.meta.path, "repository IPC lifecycle in isolation")) {
	const handlers = new Map<string, (event: unknown, path: string) => Promise<void>>();
	const closeHandlers = new Map<object, () => void>();
	let starts = 0;
	let stops = 0;
	let ready: (() => void)[] = [];
	mock.module("electron", () => ({
		ipcMain: {
			handle: (name: string, handler: (event: unknown, path: string) => Promise<void>) =>
				handlers.set(name, handler),
		},
		BrowserWindow: { fromWebContents: (sender: unknown) => sender },
	}));
	mock.module("../src/main/git/repo-watcher-instance", () => ({
		getRepoWatcherManager: () => ({
			subscribe: async () => {
				starts++;
				await new Promise<void>((resolve) => ready.push(resolve));
				return async () => {
					stops++;
				};
			},
		}),
		disposeRepoWatcherManager: async () => {},
	}));
	mock.module("../src/main/logger", () => ({ log: { error() {} } }));
	const { setupRepoIPC } = await import("../src/main/repo-ipc");
	setupRepoIPC(() => null);
	function testWindow() {
		return {
			isDestroyed: () => false,
			webContents: { send() {} },
			on(_name: string, callback: () => void) {
				closeHandlers.set(this, callback);
			},
		};
	}
	async function finishStarting() {
		for (const resolve of ready) resolve();
		ready = [];
		await Promise.resolve();
	}

	test("overlapping Files and panel subscriptions share one IPC registration and clean up once", async () => {
		starts = 0;
		stops = 0;
		const window = testWindow();
		const event = { sender: window };
		const first = handlers.get("repo:subscribe")?.(event, "/fixture/a");
		const second = handlers.get("repo:subscribe")?.(event, "/fixture/a");
		await finishStarting();
		await Promise.all([first, second]);
		expect(starts).toBe(1);
		await handlers.get("repo:unsubscribe")?.(event, "/fixture/a");
		expect(stops).toBe(0);
		await handlers.get("repo:unsubscribe")?.(event, "/fixture/a");
		expect(stops).toBe(1);
	});

	test("unsubscribe while a watcher starts does not leave a stale subscription", async () => {
		stops = 0;
		const event = { sender: testWindow() };
		const starting = handlers.get("repo:subscribe")?.(event, "/fixture/b");
		const stopping = handlers.get("repo:unsubscribe")?.(event, "/fixture/b");
		await finishStarting();
		await Promise.all([starting, stopping]);
		expect(stops).toBe(1);
	});
}
