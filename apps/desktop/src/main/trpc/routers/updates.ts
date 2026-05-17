import { app } from "electron";
import { autoUpdater } from "electron-updater";
import { z } from "zod";
import { log } from "../../logger";
import { getMainWindow } from "../../main-window";
import {
	dismissUpdateVersion,
	fetchReleaseNotes,
	getUpdaterState,
	markVersionSeen,
} from "../../updater";
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
			dismissedUpdateVersion: state.dismissedUpdateVersion,
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
			log.error("[updater] Check for updates failed:", message);
			return { updateAvailable: false, version: null, error: message };
		}
	}),

	installUpdate: publicProcedure.mutation(() => {
		if (!app.isPackaged) return;
		const t0 = Date.now();
		log.info("[updater] installUpdate mutation entered");
		// Close the main window first so the renderer can release tRPC
		// subscriptions and IPC handles in a controlled order, then trigger
		// quitAndInstall on the next tick. This avoids racing window close
		// with main-process teardown.
		const win = getMainWindow();
		if (win && !win.isDestroyed()) {
			log.debug(`[updater] closing main window +${Date.now() - t0}ms`);
			win.close();
		}
		setImmediate(() => {
			log.debug(`[updater] calling quitAndInstall +${Date.now() - t0}ms`);
			try {
				autoUpdater.quitAndInstall();
				log.debug(`[updater] quitAndInstall returned +${Date.now() - t0}ms`);
			} catch (err) {
				log.error("[updater] quitAndInstall threw:", err);
			}
		});
	}),

	markVersionSeen: publicProcedure
		.input(z.object({ version: z.string() }))
		.mutation(({ input }) => {
			markVersionSeen(input.version);
		}),

	dismissUpdate: publicProcedure.input(z.object({ version: z.string() })).mutation(({ input }) => {
		dismissUpdateVersion(input.version);
	}),
});
