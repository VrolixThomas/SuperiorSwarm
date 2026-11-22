import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { BrowserWindow, app, ipcMain, session } from "electron";
import { ReviewSnapshotService } from "../../../src/main/review-explanation/snapshot";
import { router } from "../../../src/main/trpc";
import { setupTRPCIPC } from "../../../src/main/trpc/ipc-link";
import { createReviewExplanationRouter } from "../../../src/main/trpc/routers/review-explanation";

const root = process.env["SS_SNAPSHOT_FIXTURE"];
if (!root) throw new Error("Isolated fixture root required");
app.setPath("userData", join(root, "profile"));
app.setPath("sessionData", join(root, "profile"));
app.setPath("crashDumps", join(root, "profile"));
app.setAppLogsPath(join(root, "profile", "logs"));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-background-networking");
async function run(root: string) {
	await app.whenReady();
	session.defaultSession.webRequest.onBeforeRequest((details, done) =>
		done({ cancel: !details.url.startsWith("file://") && !details.url.startsWith("devtools://") })
	);
	setupTRPCIPC(
		router({
			reviewExplanation: createReviewExplanationRouter(
				new ReviewSnapshotService({
					resolveRoot: async (id) => {
						if (id !== "registered") throw new Error("Unregistered fixture workspace");
						return join(root, "repo");
					},
				})
			),
		})
	);
	ipcMain.handle("fixture:complete", (_event, result: unknown) => {
		writeFileSync(join(root, "result.json"), JSON.stringify(result));
		app.exit(0);
	});
	const window = new BrowserWindow({
		show: false,
		webPreferences: { contextIsolation: true, sandbox: true, preload: join(root, "preload.cjs") },
	});
	await window.loadFile(join(root, "index.html"), {
		query: {
			head: process.env["SS_SNAPSHOT_HEAD"] ?? "",
			base: process.env["SS_SNAPSHOT_BASE"] ?? "",
		},
	});
	setTimeout(async () => {
		console.error(
			"Snapshot fixture stalled:",
			await window.webContents.executeJavaScript("document.body.innerText")
		);
	}, 10000).unref();
}
void run(root).catch((error) => {
	console.error(error);
	app.exit(1);
});
