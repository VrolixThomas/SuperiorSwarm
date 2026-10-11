const { app, BrowserWindow } = require("electron");
const path = require("node:path");
app.setPath("userData", path.join(process.argv[2], "profile"));
app.dock?.hide();
const deadline = setTimeout(() => app.exit(1), 25000);
app.whenReady().then(async () => {
	let window;
	try {
		window = new BrowserWindow({
			show: false,
			width: 1200,
			height: 800,
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
		window.webContents.debugger.attach("1.3");
		const results = [];
		for (const mode of ["normal", "alternate", "sgr", "sgr-pixels"]) {
			for (const [adapter, sensitivity] of [
				[false, 1],
				[false, 3],
				[true, 3],
			]) {
				for (const [deltaY, count] of [
					[-4, 10],
					[-120, 1],
				]) {
					const { x, y, cellHeight } = await window.webContents.executeJavaScript(
						`window.nativeWheel.setup(${adapter}, ${JSON.stringify(mode)}, ${sensitivity})`
					);
					for (let i = 0; i < count; i++) {
						await window.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {
							type: "mouseWheel",
							x,
							y,
							deltaX: 0,
							deltaY,
						});
					}
					const result = await window.webContents.executeJavaScript("window.nativeWheel.result()");
					results.push({ mode, adapter, sensitivity, deltaY, count, cellHeight, ...result });
				}
			}
		}
		console.log(JSON.stringify(results));
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
