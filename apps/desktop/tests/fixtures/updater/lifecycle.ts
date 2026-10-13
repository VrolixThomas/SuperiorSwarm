import "../../preload-electron-mock";
import { afterEach, beforeAll, beforeEach, expect, mock, test } from "bun:test";
import { EventEmitter } from "node:events";
import { join } from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const sequence: string[] = [];
let visible = true;
const window = {
	isDestroyed: () => !visible,
	close: () => {
		sequence.push("window.close");
		visible = false;
	},
};
class NativeUpdater extends EventEmitter {
	checkForUpdates = mock(() => {});
	quitAndInstall = mock(() => {
		sequence.push("native.quitAndInstall");
		this.emit("before-quit-for-update");
		window.close(); // Electron owns window closure after native validation.
		sequence.push("app.quit/relaunch");
	});
}
const nativeUpdater = new NativeUpdater();

// Model the locked MacUpdater's two downloaded events and persistent callback
// when quitAndInstall is called before Squirrel finishes validation.
class FakeMacUpdater extends EventEmitter {
	autoDownload = false;
	autoInstallOnAppQuit = true;
	squirrelDownloadedUpdate = false;
	checkForUpdates = mock(async () => {
		this.emit("checking-for-update");
		this.emit("update-available", { version: "0.23.2" });
		return { updateInfo: { version: "0.23.2" } };
	});
	quitAndInstall = mock(() => {
		sequence.push("updater.quitAndInstall");
		if (this.squirrelDownloadedUpdate) nativeUpdater.quitAndInstall();
		else {
			nativeUpdater.on("update-downloaded", () => nativeUpdater.quitAndInstall());
			if (!this.autoInstallOnAppQuit) nativeUpdater.checkForUpdates();
		}
	});
}
const updater = new FakeMacUpdater();
nativeUpdater.on("error", (error) => updater.emit("error", error));
nativeUpdater.on("update-downloaded", () => {
	updater.squirrelDownloadedUpdate = true;
});
const app = {
	isPackaged: true,
	getVersion: () => "0.23.0",
	getPath: () => `/tmp/superiorswarm-test-${process.pid}`,
};
mock.module("electron", () => ({ app, autoUpdater: nativeUpdater }));
mock.module("electron-updater", () => ({ autoUpdater: updater }));

const { getDb } = await import("../../../src/main/db");
const { sessionState } = await import("../../../src/main/db/schema");
const { initializeUpdater, teardownUpdater, getUpdaterState } = await import(
	"../../../src/main/updater"
);
const { setMainWindow } = await import("../../../src/main/main-window");
const { updatesRouter } = await import("../../../src/main/trpc/routers/updates");
const caller = updatesRouter.createCaller({});

beforeAll(() => {
	migrate(getDb(), { migrationsFolder: join(import.meta.dir, "../../../src/main/db/migrations") });
	getDb()
		.insert(sessionState)
		.values({ key: "lastSeenVersion", value: "0.23.0" })
		.onConflictDoUpdate({ target: sessionState.key, set: { value: "0.23.0" } })
		.run();
});
beforeEach(async () => {
	visible = true;
	updater.squirrelDownloadedUpdate = false;
	updater.quitAndInstall.mockClear();
	nativeUpdater.quitAndInstall.mockClear();
	nativeUpdater.checkForUpdates.mockClear();
	sequence.length = 0;
	setMainWindow(window as never);
	await initializeUpdater();
	updater.emit("update-available", { version: "0.23.2" });
	updater.emit("update-downloaded", { version: "0.23.2" });
});
afterEach(() => teardownUpdater());

test("Restart retains the window while native validation is pending", async () => {
	await caller.installUpdate();
	await new Promise((resolve) => setImmediate(resolve));
	expect(visible).toBe(true);
	expect(sequence).not.toContain("window.close");
});

test("delayed native requirement failure clears restart-ready state through the router", async () => {
	expect(getUpdaterState().updateDownloaded).toBe(true);
	await caller.installUpdate();
	await new Promise((resolve) => setImmediate(resolve));
	nativeUpdater.emit("error", new Error("code failed to satisfy specified code requirement(s)"));
	expect((await caller.getStatus()).updateDownloaded).toBe(false);
	expect(visible).toBe(true);
});

test("duplicate Restart waits for native validation, then quits exactly once", async () => {
	const listenerCount = nativeUpdater.listenerCount("update-downloaded");
	await Promise.all([caller.installUpdate(), caller.installUpdate(), caller.installUpdate()]);
	expect(nativeUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
	expect(updater.quitAndInstall).toHaveBeenCalledTimes(0);
	expect(nativeUpdater.listenerCount("update-downloaded")).toBe(listenerCount);
	expect((await caller.getStatus()).phase).toBe("validating");
	nativeUpdater.emit("update-downloaded");
	nativeUpdater.emit("update-downloaded");
	await caller.installUpdate();
	expect(updater.quitAndInstall).toHaveBeenCalledTimes(1);
	expect(nativeUpdater.quitAndInstall).toHaveBeenCalledTimes(1);
	expect(sequence).toEqual([
		"updater.quitAndInstall",
		"native.quitAndInstall",
		"window.close",
		"app.quit/relaunch",
	]);
	expect((await caller.getStatus()).phase).toBe("installing");
});

test("requirement mismatch exposes safe reinstall guidance and blocks Restart", async () => {
	await caller.installUpdate();
	nativeUpdater.emit(
		"error",
		new Error("/private/tmp/update.app: code failed to satisfy specified code requirement(s)")
	);
	const state = await caller.getStatus();
	expect(state.phase).toBe("validation-failed");
	expect(state.recovery).toBe("reinstall");
	expect(state.message).toContain("signed");
	expect(state.message).not.toContain("/private");
	expect(state.message).not.toContain("ad-hoc");
	await caller.installUpdate();
	expect(updater.quitAndInstall).toHaveBeenCalledTimes(0);
});

test("generic validation transport failure recovers via a new check and successful retry", async () => {
	await caller.installUpdate();
	nativeUpdater.emit("error", new Error("ECONNRESET /private/tmp/update.zip"));
	const state = await caller.getStatus();
	expect(state.phase).toBe("error");
	expect(state.recovery).toBe("retry");
	expect(state.message).not.toContain("signed");
	expect(state.updateDownloaded).toBe(false);
	await caller.checkForUpdates();
	updater.emit("update-downloaded", { version: "0.23.2" });
	await caller.installUpdate();
	nativeUpdater.emit("update-downloaded");
	expect(nativeUpdater.quitAndInstall).toHaveBeenCalledTimes(1);
});

test("initialize is idempotent and teardown removes only owned listeners", async () => {
	const unrelated = () => {};
	updater.on("error", unrelated);
	const count = updater.listenerCount("error");
	await initializeUpdater();
	await initializeUpdater();
	expect(updater.listenerCount("error")).toBe(count);
	teardownUpdater();
	expect(updater.listeners("error")).toEqual([unrelated]);
	expect(nativeUpdater.listenerCount("update-downloaded")).toBe(1);
	updater.removeListener("error", unrelated);
});

test("a late install failure recreates a usable main window", async () => {
	teardownUpdater();
	const restoreWindow = mock(() => {
		visible = true;
		setMainWindow(window as never);
	});
	await initializeUpdater({ restoreWindow });
	updater.emit("update-downloaded", { version: "0.23.2" });
	await caller.installUpdate();
	nativeUpdater.emit("update-downloaded");
	expect(visible).toBe(false);
	nativeUpdater.emit("error", new Error("Could not launch the installer"));
	expect(restoreWindow).toHaveBeenCalledTimes(1);
	expect(visible).toBe(true);
	expect((await caller.getStatus()).recovery).toBe("retry");
});

test("first launch still registers updater listeners", async () => {
	teardownUpdater();
	const { eq } = await import("drizzle-orm");
	getDb().delete(sessionState).where(eq(sessionState.key, "lastSeenVersion")).run();
	await initializeUpdater();
	expect(updater.listenerCount("error")).toBe(1);
	updater.emit("update-downloaded", { version: "0.23.2" });
	expect((await caller.getStatus()).phase).toBe("downloaded");
});

test("recreated window receives the latest failure via the same router", async () => {
	await caller.installUpdate();
	window.close(); // Unrelated user close on macOS; process remains alive.
	setMainWindow(null);
	nativeUpdater.emit("error", new Error("Connection reset"));
	visible = true;
	setMainWindow(window as never);
	expect((await updatesRouter.createCaller({}).getStatus()).phase).toBe("error");
	expect(nativeUpdater.listenerCount("update-downloaded")).toBe(2);
});

test("native signature failure stays distinct from requirement incompatibility", async () => {
	await caller.installUpdate();
	nativeUpdater.emit(
		"error",
		new Error("The update is improperly signed and could not be validated")
	);
	expect((await caller.getStatus()).phase).toBe("validation-failed");
	expect((await caller.getStatus()).recovery).toBe("retry");
});

const { createUpdaterLifecycle } = await import("../../../src/main/updater-lifecycle");
test("a silent native attempt times out, ignores late success, and never queues another install", async () => {
	teardownUpdater();
	const service = createUpdaterLifecycle(updater as never, nativeUpdater as never, {
		platform: "darwin",
		timeoutMs: 10,
	});
	try {
		await service.check();
		updater.emit("update-downloaded", { version: "0.23.2" });
		service.install();
		await new Promise((resolve) => setTimeout(resolve, 25));
		expect(service.getState().recovery).toBe("restart-app");
		expect(service.getState().updateDownloaded).toBe(false);
		service.install();
		nativeUpdater.emit("update-downloaded");
		expect(updater.quitAndInstall).toHaveBeenCalledTimes(0);
		expect(visible).toBe(true);
	} finally {
		service.dispose();
	}
});

test("Windows/Linux path invokes the library once and waits for the authoritative quit signal", async () => {
	teardownUpdater();
	const install = updater.quitAndInstall;
	updater.quitAndInstall = mock(() => {
		sequence.push("install-started");
	});
	const service = createUpdaterLifecycle(updater as never, nativeUpdater as never, {
		platform: "win32",
	});
	try {
		await service.check();
		updater.emit("update-downloaded", { version: "0.23.2" });
		service.install();
		service.install();
		expect(updater.quitAndInstall).toHaveBeenCalledTimes(1);
		expect(visible).toBe(true);
		expect(service.getState().phase).toBe("validating");
		nativeUpdater.emit("before-quit-for-update");
		expect(service.getState().phase).toBe("installing");
	} finally {
		service.dispose();
		updater.quitAndInstall = install;
	}
});

test("window recovery uses the normal recreation path after native closure", async () => {
	const windows = await import("../../../src/main/main-window");
	setMainWindow(null);
	const create = mock(() => {
		visible = true;
		setMainWindow(window as never);
	});
	windows.recoverMainWindow(create);
	expect(create).toHaveBeenCalledTimes(1);
	const show = mock(() => {});
	const restore = mock(() => {});
	const focus = mock(() => {});
	setMainWindow({
		isDestroyed: () => false,
		isMinimized: () => true,
		show,
		restore,
		focus,
	} as never);
	windows.recoverMainWindow(create);
	expect(create).toHaveBeenCalledTimes(1);
	expect(show).toHaveBeenCalledTimes(1);
	expect(restore).toHaveBeenCalledTimes(1);
	expect(focus).toHaveBeenCalledTimes(1);
});

test("generic install failure gives install recovery rather than network or signing diagnosis", async () => {
	await caller.installUpdate();
	nativeUpdater.emit("error", new Error("Disk full"));
	expect((await caller.getStatus()).message).toContain("could not be installed");
	expect((await caller.getStatus()).message).not.toContain("connection");
});

test("checking and download failures are distinct and can retry without stale success", async () => {
	nativeUpdater.emit("error", new Error("reset"));
	updater.checkForUpdates.mockImplementationOnce(async () => {
		throw new Error("HTTP 503 /private/cache");
	});
	await caller.checkForUpdates();
	expect((await caller.getStatus()).message).toContain("check for updates");
	await caller.checkForUpdates();
	updater.emit("download-progress", { percent: 15 });
	expect((await caller.getStatus()).phase).toBe("downloading");
	const calls = updater.checkForUpdates.mock.calls.length;
	await caller.checkForUpdates();
	expect(updater.checkForUpdates.mock.calls.length).toBe(calls);
	updater.emit("error", new Error("Download disconnected"));
	expect((await caller.getStatus()).message).toContain("could not be downloaded");
	updater.emit("update-downloaded", { version: "0.23.2" });
	expect((await caller.getStatus()).phase).toBe("error");
});

test("synchronous native validation exception leaves controls recoverable", async () => {
	nativeUpdater.checkForUpdates.mockImplementationOnce(() => {
		throw new Error("Could not start updater");
	});
	await caller.installUpdate();
	expect((await caller.getStatus()).recovery).toBe("retry");
	expect(visible).toBe(true);
});

test("teardown during asynchronous initialization cannot register listeners afterward", async () => {
	teardownUpdater();
	const originalFetch = globalThis.fetch;
	let release: (value: Response) => void = () => {};
	globalThis.fetch = mock(
		() =>
			new Promise<Response>((resolve) => {
				release = resolve;
			})
	) as unknown as typeof fetch;
	getDb()
		.insert(sessionState)
		.values({ key: "lastSeenVersion", value: "0.22.0" })
		.onConflictDoUpdate({ target: sessionState.key, set: { value: "0.22.0" } })
		.run();
	try {
		const pending = initializeUpdater();
		teardownUpdater();
		release(new Response(JSON.stringify({ body: "Test release" }), { status: 200 }));
		await pending;
		expect(updater.listenerCount("error")).toBe(0);
	} finally {
		globalThis.fetch = originalFetch;
		getDb()
			.insert(sessionState)
			.values({ key: "lastSeenVersion", value: "0.23.0" })
			.onConflictDoUpdate({ target: sessionState.key, set: { value: "0.23.0" } })
			.run();
	}
});
