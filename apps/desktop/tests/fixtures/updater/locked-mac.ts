import "../../preload-electron-mock";
import { expect, mock, test } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const native = Object.assign(new EventEmitter(), {
	setFeedURL: mock(() => {}),
	checkForUpdates: mock(() => {}),
	quitAndInstall: mock(() => {
		native.emit("before-quit-for-update");
	}),
});
mock.module("electron", () => ({ autoUpdater: native, app: { isPackaged: false } }));
const { MacUpdater } = await import("electron-updater/out/MacUpdater");
const { createUpdaterLifecycle } = await import("../../../src/main/updater-lifecycle");

test("locked MacUpdater serves downloaded bytes before native validation and quits only once after success", async () => {
	const directory = mkdtempSync(join(tmpdir(), "superiorswarm-updater-seam-"));
	const file = join(directory, "fixture.zip");
	writeFileSync(file, "inert fixture, never opened by a real updater");
	const updater = new MacUpdater(undefined, { version: "0.23.0" } as never);
	updater.logger = null;
	// Replace only network discovery. Exercise the installed library's actual
	// updateDownloaded, native event forwarding, squirrel flag and quitAndInstall.
	updater.checkForUpdates = mock(async () => {
		updater.emit("update-available", {
			version: "0.23.2",
			files: [],
			path: "fixture.zip",
			sha512: "",
			releaseDate: "2026-10-13",
		});
		return null;
	});
	const seam = updater as unknown as {
		updateDownloaded: (fileInfo: unknown, event: unknown) => Promise<string[]>;
		closeServerIfExists: () => void;
	};
	const lifecycle = createUpdaterLifecycle(updater, native as never, { platform: "darwin" });
	const baseline = native.listenerCount("update-downloaded");
	async function download() {
		await lifecycle.check();
		await seam.updateDownloaded(
			{ url: new URL("https://example.invalid/fixture.zip"), info: { size: 43 } },
			{ version: "0.23.2", downloadedFile: file }
		);
	}
	try {
		await download();
		expect(lifecycle.getState().phase).toBe("downloaded");
		expect(native.checkForUpdates).toHaveBeenCalledTimes(0);
		lifecycle.install();
		lifecycle.install();
		expect(native.checkForUpdates).toHaveBeenCalledTimes(1);
		expect(native.listenerCount("update-downloaded")).toBe(baseline);
		native.emit("error", new Error("Connection reset"));
		expect(lifecycle.getState().phase).toBe("error");
		await download();
		lifecycle.install();
		native.emit("update-downloaded");
		native.emit("update-downloaded");
		expect(lifecycle.getState().phase).toBe("installing");
		expect(native.quitAndInstall).toHaveBeenCalledTimes(1);
		expect(native.listenerCount("update-downloaded")).toBe(baseline);
	} finally {
		lifecycle.dispose();
		seam.closeServerIfExists();
		rmSync(directory, { recursive: true, force: true });
	}
	expect(native.listenerCount("update-downloaded")).toBe(baseline - 1);
});
