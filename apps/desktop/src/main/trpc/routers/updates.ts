import { app } from "electron";
import { z } from "zod";
import { fetchReleaseNotes, getUpdaterState, markVersionSeen } from "../../updater";
import { publicProcedure, router } from "../index";

export const updatesRouter = router({
	getStatus: publicProcedure.query(() => {
		const state = getUpdaterState();
		return {
			currentVersion: state.currentVersion,
			lastSeenVersion: state.lastSeenVersion,
			updateAvailable: state.updateAvailable,
			updateVersion: state.updateVersion,
			downloadProgress: state.downloadProgress,
			updateDownloaded: state.updateDownloaded,
			pendingNotification: state.pendingNotification,
		};
	}),

	getReleaseNotes: publicProcedure
		.input(z.object({ version: z.string().optional() }))
		.query(async ({ input }) => {
			const state = getUpdaterState();
			const version = input.version ?? state.currentVersion;
			const release = await fetchReleaseNotes(version);
			return {
				version,
				body: release?.body ?? null,
				publishedAt: release?.publishedAt ?? null,
			};
		}),

	checkForUpdates: publicProcedure.mutation(async () => {
		if (!app.isPackaged) {
			return { updateAvailable: false, version: null, error: "Updates unavailable in dev mode" };
		}
		try {
			const { autoUpdater } = await import("electron-updater");
			const result = await autoUpdater.checkForUpdates();
			const updateInfo = result?.updateInfo;
			if (updateInfo) {
				const current = app.getVersion();
				const latest = updateInfo.version;
				const hasUpdate = latest !== current;
				return {
					updateAvailable: hasUpdate,
					version: latest,
					error: null,
				};
			}
			return {
				updateAvailable: false,
				version: null,
				error: null,
			};
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			console.error("[updater] Check for updates failed:", message);
			return { updateAvailable: false, version: null, error: message };
		}
	}),

	installUpdate: publicProcedure.mutation(async () => {
		if (!app.isPackaged) return;
		try {
			const { autoUpdater } = await import("electron-updater");
			autoUpdater.quitAndInstall();
		} catch (err) {
			console.error("[updater] Install update failed:", err);
		}
	}),

	markVersionSeen: publicProcedure
		.input(z.object({ version: z.string() }))
		.mutation(({ input }) => {
			markVersionSeen(input.version);
		}),
});
