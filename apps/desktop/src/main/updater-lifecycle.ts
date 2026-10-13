import type { AutoUpdater } from "electron";
import type { AppUpdater } from "electron-updater";
import {
	type UpdateLifecycleState,
	canCheckForUpdates,
	initialUpdateLifecycle,
} from "../shared/updater";
import { log } from "./logger";

/** Owns only our listeners. Never close windows or remove the library's listeners. */
export function createUpdaterLifecycle(
	updater: Pick<
		AppUpdater,
		| "on"
		| "removeListener"
		| "checkForUpdates"
		| "quitAndInstall"
		| "autoDownload"
		| "autoInstallOnAppQuit"
	>,
	native: Pick<AutoUpdater, "on" | "removeListener" | "checkForUpdates">,
	options: { platform: string; restoreWindow?: () => void; timeoutMs?: number }
) {
	let state = { ...initialUpdateLifecycle };
	let disposed = false;
	let operation = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let installCalled = false;
	const cleanups: (() => void)[] = [];

	function change(patch: Partial<UpdateLifecycleState>) {
		state = { ...state, ...patch, revision: state.revision + 1 };
	}
	function clearTimer() {
		clearTimeout(timer);
		timer = undefined;
	}
	function fail(error: unknown) {
		if (disposed) return;
		log.error("[updater] Update failed:", error);
		if (state.phase === "error" || state.phase === "validation-failed") return;
		const wasInstalling = state.phase === "installing";
		const genericMessage =
			state.phase === "checking"
				? "Could not check for updates. Check your connection and try again."
				: state.phase === "available" || state.phase === "downloading"
					? "The update could not be downloaded. Check your connection and try again."
					: "The update could not be installed. Try checking for updates again. If it keeps failing, quit and reopen SuperiorSwarm.";
		const message = error instanceof Error ? error.message : String(error);
		const mismatch =
			/code failed to satisfy specified code requirement|designated requirement|does not pass.*code signing requirement/i.test(
				message
			);
		const signature =
			mismatch ||
			/code sign|signature|improperly signed|err_updater_invalid_signature/i.test(message);
		clearTimer();
		change({
			phase: signature ? "validation-failed" : "error",
			recovery: mismatch ? "reinstall" : "retry",
			message: mismatch
				? "The update was downloaded, but this installation cannot accept its signing requirements. Reinstall SuperiorSwarm from the signed download."
				: signature
					? "The update could not be verified. Check for updates to download it again."
					: genericMessage,
			updateDownloaded: false,
			downloadProgress: null,
		});
		if (wasInstalling) options.restoreWindow?.();
	}
	function armTimer() {
		clearTimer();
		timer = setTimeout(
			() => {
				const wasInstalling = state.phase === "installing";
				log.error("[updater] Timed out waiting for updater lifecycle", { phase: state.phase });
				change({
					phase: "error",
					recovery: "restart-app",
					message:
						"The updater did not finish. You can keep working. Quit and reopen SuperiorSwarm before trying again, or use the signed download to reinstall.",
					updateDownloaded: false,
					downloadProgress: null,
				});
				if (wasInstalling) options.restoreWindow?.();
			},
			options.timeoutMs ?? (state.phase === "downloading" ? 10 * 60_000 : 60_000)
		);
		timer.unref();
	}
	function installValidatedUpdate() {
		if (disposed || state.phase !== "validating" || installCalled) return;
		installCalled = true;
		try {
			// MacUpdater 6.8.3's constructor has now set squirrelDownloadedUpdate.
			// Calling earlier registers an uncancellable persistent quit callback.
			updater.quitAndInstall();
		} catch (error) {
			fail(error);
		}
	}
	const onAvailable = (info: { version: string }) => {
		if (state.phase !== "checking") return;
		change({ phase: "available", updateAvailable: true, updateVersion: info.version });
		armTimer();
	};
	const onNotAvailable = () => {
		if (state.phase !== "checking") return;
		clearTimer();
		change({ phase: "idle", updateAvailable: false, updateVersion: null });
	};
	const onProgress = (progress: { percent: number }) => {
		if (state.phase !== "available" && state.phase !== "downloading") return;
		change({ phase: "downloading", downloadProgress: Math.round(progress.percent) });
		armTimer();
	};
	const onDownloaded = () => {
		if (state.phase !== "available" && state.phase !== "downloading") return;
		clearTimer();
		change({ phase: "downloaded", updateDownloaded: true, downloadProgress: null });
	};
	const onBeforeQuit = () => {
		if (state.phase !== "validating" || !installCalled) return;
		change({ phase: "installing" });
		armTimer();
	};
	const onNativeNotAvailable = () => {
		if (state.phase === "validating") fail(new Error("Native updater found no pending update"));
	};

	updater.autoDownload = true;
	// Native validation starts explicitly at Restart on macOS. Other platforms
	// also install only on explicit consent, so failed downloads cannot install on quit.
	updater.autoInstallOnAppQuit = false;
	updater.on("update-available", onAvailable);
	updater.on("update-not-available", onNotAvailable);
	updater.on("download-progress", onProgress);
	updater.on("update-downloaded", onDownloaded);
	updater.on("error", fail);
	cleanups.push(() => {
		updater.removeListener("update-available", onAvailable);
		updater.removeListener("update-not-available", onNotAvailable);
		updater.removeListener("download-progress", onProgress);
		updater.removeListener("update-downloaded", onDownloaded);
		updater.removeListener("error", fail);
	});
	native.on("before-quit-for-update", onBeforeQuit);
	cleanups.push(() => native.removeListener("before-quit-for-update", onBeforeQuit));
	if (options.platform === "darwin") {
		native.on("update-downloaded", installValidatedUpdate);
		native.on("update-not-available", onNativeNotAvailable);
		cleanups.push(() => {
			native.removeListener("update-downloaded", installValidatedUpdate);
			native.removeListener("update-not-available", onNativeNotAvailable);
		});
	}

	return {
		getState: () => ({ ...state }),
		async check() {
			if (disposed || !canCheckForUpdates(state)) return;
			const currentOperation = ++operation;
			installCalled = false;
			change({
				phase: "checking",
				recovery: "none",
				message: null,
				updateDownloaded: false,
				downloadProgress: null,
			});
			armTimer();
			try {
				const result = await updater.checkForUpdates();
				// The library emits errors AND rejects; consume the download promise too.
				await result?.downloadPromise;
				if (!disposed && currentOperation === operation && state.phase === "checking")
					onNotAvailable();
			} catch (error) {
				if (
					!disposed &&
					currentOperation === operation &&
					state.phase !== "error" &&
					state.phase !== "validation-failed"
				)
					fail(error);
			}
		},
		install() {
			if (disposed || state.phase !== "downloaded") return;
			change({ phase: "validating", updateDownloaded: false, message: null });
			armTimer();
			try {
				if (options.platform === "darwin") native.checkForUpdates();
				else installValidatedUpdate();
			} catch (error) {
				fail(error);
			}
		},
		dispose() {
			disposed = true;
			clearTimer();
			for (const cleanup of cleanups) cleanup();
		},
	};
}
