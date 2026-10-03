// Isolated test process: never imports the desktop app or connects to its daemon.
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
app.setPath("userData", path.join(process.argv[2], "profile"));
app.commandLine.appendSwitch("no-proxy-server");
app.dock?.hide();
const deadline = setTimeout(() => app.exit(1), 20000);
app.whenReady().then(async () => {
	let window;
	try {
		window = new BrowserWindow({
			show: false,
			width: 3000,
			height: 900,
			webPreferences: {
				backgroundThrottling: false,
				contextIsolation: true,
				nodeIntegration: false,
			},
		});
		window.webContents.session.webRequest.onBeforeRequest((details, callback) =>
			callback({ cancel: !details.url.startsWith("file:") })
		);
		await window.loadFile(path.join(process.argv[2], "index.html"));
		const results = await window.webContents.executeJavaScript("window.terminalWheelTests");
		console.log(JSON.stringify({ versions: process.versions, results }));
		window.destroy();
		clearTimeout(deadline);
		app.exit(0);
	} catch (error) {
		console.error(error);
		window?.destroy();
		clearTimeout(deadline);
		app.exit(1);
	}
});
