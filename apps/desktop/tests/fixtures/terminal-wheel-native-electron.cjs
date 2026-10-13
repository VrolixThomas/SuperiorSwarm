const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
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
				[true, 1],
			]) {
				for (const [deltaY, count, deltaX = 0] of [
					[-4, 10],
					[-120, 1],
					[-120, 1, 119],
					[-120, 1, 121],
					[-1, 10],
					[-1200, 1],
				]) {
					const { x, y, cellHeight } = await window.webContents.executeJavaScript(
						`window.nativeWheel.setup(${adapter}, ${JSON.stringify(mode)}, ${sensitivity})`
					);
					for (let i = 0; i < count; i++) {
						await window.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {
							type: "mouseWheel",
							x,
							y,
							deltaX,
							deltaY,
						});
					}
					const result = await window.webContents.executeJavaScript("window.nativeWheel.result()");
					results.push({
						mode,
						adapter,
						sensitivity,
						deltaY,
						deltaX,
						count,
						cellHeight,
						...result,
					});
				}
			}
		}
		const replay = JSON.parse(
			fs.readFileSync(path.join(process.argv[2], "legacy-replay.json"), "utf8")
		);
		const { x, y, cellHeight } = await window.webContents.executeJavaScript(
			'window.nativeWheel.setup(true, "normal", 1)'
		);
		await window.webContents.executeJavaScript(
			`window.nativeWheel.restore(${JSON.stringify(replay)})`
		);
		await window.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {
			type: "mouseWheel",
			x,
			y,
			deltaX: 0,
			deltaY: -120,
		});
		const returned = await window.webContents.executeJavaScript("window.nativeWheel.result()");
		results.push({
			mode: "legacy-return",
			adapter: true,
			sensitivity: 1,
			deltaY: -120,
			deltaX: 0,
			count: 1,
			cellHeight,
			...returned,
		});
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
