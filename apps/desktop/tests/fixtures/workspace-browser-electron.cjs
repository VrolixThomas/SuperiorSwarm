// Real Electron guest/host integration. No user account, agent process, or production data.
const { app, BrowserWindow, webContents, ipcMain } = require("electron");
const { createServer } = require("node:http");
const { createHash } = require("node:crypto");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");
const fs = require("node:fs");
const assert = require("node:assert/strict");
const directory = process.argv[2];
const restoring = process.argv[3] === "restore";
app.setPath("userData", join(directory, "profile"));
app.dock?.hide();
const deadline = setTimeout(() => app.exit(1), process.env.BROWSER_SMOKE_URL ? 90000 : 45000);
const checks = [];
async function wait(label, read, timeout = 10000) {
	const end = Date.now() + timeout;
	while (Date.now() < end) {
		const value = await read();
		if (value) return value;
		await new Promise((resolve) => setTimeout(resolve, 32));
	}
	throw Error(`Timed out: ${label}`);
}
app.whenReady().then(async () => {
	let window;
	let runtime;
	let server;
	let recoveryServer;
	try {
		server = createServer((req, res) => {
			res.setHeader("Content-Type", "text/html");
			if (req.url === "/auth") {
				res.end(
					`<title>Authentication fixture</title><button id="complete" onclick="localStorage.setItem('signed-in','yes');opener.postMessage('authenticated',location.origin);window.close()">Complete sign-in</button>`
				);
				return;
			}
			res.end(
				`<!doctype html><title>Browser fixture</title><style>body{font:18px system-ui;padding:32px;background:#f3f5fb}input,button,a{font:inherit;padding:8px}h1{color:#21345b}</style><h1>${req.url === "/two" ? "Second page" : "Local preview"}</h1><label>Draft <input id="draft" placeholder="Write here"></label><button id="apply" onclick="document.querySelector('#result').textContent=document.querySelector('#draft').value">Apply</button><p id="result"></p><a href="/two">Next page</a><a id="newtab" href="/two" target="_blank">Open tab</a><button id="auth" onclick="window.open('/auth','sign-in','width=420,height=400')">Sign in</button><p id="socket">Connecting</p><input type="password" value="secret"><script>const ws=new WebSocket('ws://'+location.host+'/hmr');ws.onmessage=()=>document.querySelector('#socket').textContent='HMR connected';window.onmessage=e=>{if(e.origin===location.origin)document.querySelector('#result').textContent=e.data};</script>`
			);
		});
		server.on("upgrade", (req, socket) => {
			const accept = createHash("sha1")
				.update(`${req.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
				.digest("base64");
			socket.write(
				`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`
			);
			socket.write(Buffer.from([0x81, 2, 111, 107]));
			socket.on("error", () => {});
		});
		const port = restoring ? Number(fs.readFileSync(join(directory, "server-port"), "utf8")) : 0;
		await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
		fs.writeFileSync(join(directory, "server-port"), String(server.address().port));
		const url = `http://127.0.0.1:${server.address().port}/one`;
		const api = require(join(directory, "workspace-browser-main.cjs"));
		window = new BrowserWindow({
			show: false,
			width: 1100,
			height: 800,
			webPreferences: {
				preload: join(directory, "preload.cjs"),
				sandbox: true,
				contextIsolation: true,
				nodeIntegration: false,
				webviewTag: true,
				backgroundThrottling: false,
			},
		});
		runtime = new api.BrowserGuestRuntime(() => window);
		runtime.install(window);
		const service = runtime.service;
		api.setupTRPCIPC(
			api.router({
				browser: api.createBrowserRouter(
					service,
					(id) => assert.ok(["workspace-a", "workspace-b"].includes(id)),
					runtime
				),
			})
		);
		const shell = pathToFileURL(join(directory, "index.html"));
		shell.searchParams.set("url", url);
		api.rendererTrust.register(window.webContents.id, shell.href);
		if (process.env.BROWSER_APP_SHELL) {
			for (const name of [
				"terminal:resize",
				"terminal:detach",
				"terminal:dispose",
				"terminal:set-visible",
				"terminal:wake",
				"repo:subscribe",
				"repo:unsubscribe",
			])
				ipcMain.handle(name, () => undefined);
			ipcMain.handle("terminal:create", (_event, id) => {
				setTimeout(() => {
					if (!window.isDestroyed())
						window.webContents.send(
							"terminal:data",
							id,
							"\r\nIsolated acceptance terminal — no agent running.\r\n$ "
						);
				}, 50);
				return { wasAttached: false };
			});
			ipcMain.handle("daemon:status", () => true);
			ipcMain.handle("daemon:listSessions", () => []);
			window.webContents.on("console-message", (_event, level, message) => {
				if (level >= 2) console.error("[app-renderer]", message);
			});
		}
		await window.loadURL(shell.href);
		window.showInactive();
		const target = { workspaceId: "workspace-a", browserId: "browser-test" };
		const js = (code) =>
			window.webContents.executeJavaScript(code).catch((error) => {
				throw new Error(`Renderer check failed: ${code}`, { cause: error });
			});
		const guestFor = async (id) => {
			const wcId = await js(
				`document.querySelector('[data-browser-guest="${id}"]')?.getWebContentsId()`
			);
			return wcId ? webContents.fromId(wcId) : null;
		};
		await wait("registered, presented browser", () => {
			try {
				const state = service.state(target);
				return state.phase === "ready" && state.presented && state.url === url && !state.loading;
			} catch {
				return false;
			}
		});
		let guest = await guestFor(target.browserId);
		assert.ok(guest);
		assert.equal(guest.getType(), "webview");
		assert.equal(guest.hostWebContents, window.webContents);
		assert.equal(
			window.contentView.children.filter(
				(child) => child.webContents && child.webContents !== window.webContents
			).length,
			0
		);
		checks.push("persistent DOM webview, no native child presentation layer");
		const editAddress = async (value) => {
			window.focus();
			window.webContents.focus();
			await js(`(() => {
				const input = document.querySelector('[data-browser-address="browser-test"]');
				input.focus();
				Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
				input.dispatchEvent(new Event('input', {bubbles:true}));
			})()`);
			await js("new Promise(resolve => requestAnimationFrame(resolve))");
		};
		const enterAddress = async (value) => {
			await editAddress(value);
			window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Return" });
			window.webContents.sendInputEvent({ type: "char", keyCode: "\r" });
			window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Return" });
		};
		if (!restoring) {
			// Exercise real address submission and guest loading without an external search dependency.
			const requests = [];
			await guest.session.protocol.handle("https", (request) => {
				requests.push(request.url);
				return new Response("<title>Address submission fixture</title><h1>Search loaded</h1>", {
					headers: { "content-type": "text/html" },
				});
			});
			try {
				for (const [input, expected] of [
					["youtube", "https://www.google.com/search?q=youtube"],
					[
						"café & 日本語",
						`https://www.google.com/search?q=${encodeURIComponent("café & 日本語")}`,
					],
					["youtube.com", "https://youtube.com/"],
				]) {
					await enterAddress(input);
					await wait(
						`address submission: ${input}`,
						() =>
							requests.includes(expected) &&
							service.state(target).url === expected &&
							!service.state(target).loading
					);
					assert.equal(
						await guest.executeJavaScript("document.querySelector('h1').textContent"),
						"Search loaded"
					);
				}
				await enterAddress(url.replace("http://", ""));
				await wait(
					"schemeless local address loads",
					() => service.state(target).url === url && !service.state(target).loading
				);
				await js(`document.querySelector('[data-browser-address="browser-test"]').focus()`);
				assert.equal(
					await js(
						`(() => { const i=document.querySelector('[data-browser-address="browser-test"]'); return i.selectionEnd-i.selectionStart === i.value.length; })()`
					),
					true
				);
				await editAddress("discard this search");
				window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
				await wait("Escape restores current URL", () =>
					js(
						`document.querySelector('[data-browser-address="browser-test"]').value === ${JSON.stringify(url)}`
					)
				);
				await enterAddress("   ");
				await editAddress("composition in progress");
				await js(`(() => {
					const i=document.querySelector('[data-browser-address="browser-test"]');
					i.dispatchEvent(new CompositionEvent('compositionstart', {bubbles:true}));
					i.form.requestSubmit();
				})()`);
				await js(
					"new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))"
				);
				assert.equal(requests.length, 3);
				assert.equal(service.state(target).url, url);
				await js(`(() => {
					const i=document.querySelector('[data-browser-address="browser-test"]');
					i.dispatchEvent(new CompositionEvent('compositionend', {bubbles:true}));
					i.blur();
				})()`);
				checks.push(
					"address bar searches, direct URLs, localhost, select-all, Escape, blank input and IME"
				);
			} finally {
				guest.session.protocol.unhandle("https");
			}
		}
		if (process.env.BROWSER_APP_SHELL) {
			assert.ok(await js("document.body.innerText.includes('Browser acceptance')"));
			assert.ok(await js("document.querySelectorAll('[role=tab]').length >= 3"));
			assert.ok(await js("document.querySelectorAll('.xterm').length >= 2"));
			checks.push("actual App renderer with sidebar, workspace, terminals and browser tab");
			await guest.executeJavaScript("document.querySelector('#draft').value='full app preserved'");
			await js("window.browserFixture.selectTerminal()");
			await wait("actual terminal tab selected", () => !service.state(target).presented);
			await js("window.browserFixture.selectOriginal()");
			await wait("actual browser tab selected", () => service.state(target).presented);
			assert.equal((await guestFor(target.browserId)).id, guest.id);
			assert.equal(
				await guest.executeJavaScript("document.querySelector('#draft').value"),
				"full app preserved"
			);
			checks.push("actual terminal/browser tab switching retains guest and input");
			await js("window.browserFixture.split()");
			await wait("browser moved into actual split", () => service.state(target).presented);
			assert.equal((await guestFor(target.browserId)).id, guest.id);
			checks.push("actual split layout preserves the same guest");
			await js("window.browserFixture.openDialog()");
			await wait("actual dialog blocks agent", () => !service.state(target).presented);
			await js("window.browserFixture.closeDialog()");
			await wait("actual dialog closes", () => service.state(target).presented);
			checks.push("actual app modal layers above browser and restores interaction");
			guest.sendInputEvent({
				type: "keyDown",
				keyCode: "K",
				modifiers: [process.platform === "darwin" ? "meta" : "control"],
			});
			await wait("actual command palette", () => js("window.browserFixture.paletteOpen()"));
			await js("window.browserFixture.closePalette()");
			await wait("actual palette closed", () => service.state(target).presented);
			checks.push("actual command palette from focused guest");
			await wait("application modal DOM removed", () =>
				js("!document.querySelector('[data-browser-modal]')")
			);
			await js(
				"new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))"
			);
			fs.writeFileSync(
				join(directory, "full-app-state.json"),
				await js(
					"JSON.stringify({text:document.body.innerText,modals:document.querySelectorAll('[data-browser-modal]').length})"
				)
			);
			window.setTitle(
				`SuperiorSwarm — full application acceptance — Electron ${process.versions.electron}`
			);
			fs.writeFileSync(
				join(directory, "full-app.png"),
				(await window.webContents.capturePage()).toPNG()
			);
		} else if (restoring) {
			assert.equal(
				await guest.executeJavaScript("localStorage.getItem('profile-proof')"),
				"retained"
			);
			checks.push("workspace profile persists across Electron restarts");
			await js(`document.querySelector('[aria-label="Clear workspace browsing data"]').click()`);
			await wait(
				"workspace data cleared",
				async () =>
					(await guest.executeJavaScript("localStorage.getItem('profile-proof')")) === null
			);
			checks.push("clear browsing data removes persistent storage");
		} else {
			await wait("local WebSocket HMR", async () =>
				(await service.observe(target)).text.includes("HMR connected")
			);
			assert.equal(await guest.executeJavaScript("typeof window.electron"), "undefined");
			assert.equal(await guest.executeJavaScript("typeof require"), "undefined");
			checks.push("real page and HMR without app preload or Node access");
			let observation = await service.observe(target);
			assert.equal(
				observation.elements.some((element) => element.value === "secret"),
				false
			);
			const input = observation.elements.find((element) => element.name === "Draft");
			assert.ok(input);
			observation = await service.act(target, {
				kind: "type",
				documentId: observation.documentId,
				sequence: observation.sequence,
				elementId: input.id,
				text: "preserved draft",
			});
			const button = observation.elements.find((element) => element.name === "Apply");
			assert.ok(button);
			await service.act(target, {
				kind: "click",
				documentId: observation.documentId,
				sequence: observation.sequence,
				elementId: button.id,
			});
			assert.equal(
				await guest.executeJavaScript("document.querySelector('#result').textContent"),
				"preserved draft"
			);
			checks.push("agent types and clicks the same rendered guest");
			assert.equal(
				await js(
					`(()=>{const b=document.querySelector('[title="Open panel"]'),r=b.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button')===b})()`
				),
				true
			);
			await js("window.browserFixture.modal(true)");
			await wait("dialog suspends agent control", () => !service.state(target).presented);
			assert.equal(
				await js(
					"(()=>{const d=document.querySelector('dialog'),r=d.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('dialog')===d})()"
				),
				true
			);
			await js("window.browserFixture.modal(false)");
			await wait("dialog closed", () => service.state(target).presented);
			await js("window.browserFixture.hide(true)");
			await wait("hidden workspace", () => !service.state(target).presented);
			await js("window.browserFixture.hide(false)");
			await wait("shown workspace", () => service.state(target).presented);
			await js("window.browserFixture.remount()");
			await wait("remounted slot", () => service.state(target).presented);
			assert.equal((await guestFor(target.browserId)).id, guest.id);
			assert.equal(
				await guest.executeJavaScript("document.querySelector('#draft').value"),
				"preserved draft"
			);
			checks.push("app chrome, dialogs, workspace switching and remount preserve the guest");
			guest.sendInputEvent({
				type: "keyDown",
				keyCode: "K",
				modifiers: [process.platform === "darwin" ? "meta" : "control"],
			});
			await wait("command palette from guest", () => js("window.browserFixture.paletteOpen()"));
			await js("window.browserFixture.closePalette()");
			await wait("palette closed", () => service.state(target).presented);
			await js(
				`document.querySelector('select').value='phone';document.querySelector('select').dispatchEvent(new Event('change',{bubbles:true}))`
			);
			await wait(
				"phone viewport",
				async () => (await guest.executeJavaScript("innerWidth")) === 390
			);
			await js(
				`document.querySelector('select').value='desktop';document.querySelector('select').dispatchEvent(new Event('change',{bubbles:true}))`
			);
			await wait(
				"desktop viewport",
				async () => (await guest.executeJavaScript("innerWidth")) > 390
			);
			window.setSize(900, 700);
			await wait(
				"resized slot",
				async () =>
					Math.abs(
						(await guest.executeJavaScript("innerWidth")) -
							(await js("window.browserFixture.bounds().width"))
					) < 2
			);
			checks.push("native keyboard forwarding and responsive DOM viewport sizing");
			await js("document.dispatchEvent(new Event('dragstart',{bubbles:true}))");
			await wait("drag passthrough", () =>
				js("document.querySelector('webview').style.pointerEvents==='none'")
			);
			await js("document.dispatchEvent(new Event('dragend',{bubbles:true}))");
			await wait("drag completed", () => service.state(target).presented);
			await service.command(target, { kind: "agent-control", enabled: false });
			await assert.rejects(service.observe(target), /paused/);
			await service.command(target, { kind: "agent-control", enabled: true });
			await assert.rejects(
				service.observe({ ...target, workspaceId: "workspace-b" }),
				/unavailable/
			);
			checks.push("drag passthrough, user takeover and workspace isolation");
			await guest.executeJavaScript("document.querySelector('#auth').click()", true);
			const popup = await wait("real sign-in popup", () =>
				BrowserWindow.getAllWindows().find((candidate) => candidate !== window)
			);
			await wait("popup loaded", () => popup.webContents.getTitle() === "Authentication fixture");
			assert.equal(popup.webContents.session, guest.session);
			assert.equal(await popup.webContents.executeJavaScript("!!window.opener"), true);
			assert.equal(await popup.webContents.executeJavaScript("typeof require"), "undefined");
			await popup.webContents.executeJavaScript(
				"document.querySelector('#complete').click()",
				true
			);
			await wait(
				"popup callback",
				async () =>
					(await guest.executeJavaScript("document.querySelector('#result').textContent")) ===
					"authenticated"
			);
			await wait("popup closed", () => popup.isDestroyed());
			assert.equal(await guest.executeJavaScript("localStorage.getItem('signed-in')"), "yes");
			checks.push("real popup preserves opener, session, callback and closes cleanly");
			await service.command(target, { kind: "agent-control", enabled: false });
			await guest.executeJavaScript("document.querySelector('#newtab').click()", true);
			const linked = await wait("new tab attached", () =>
				service
					.list(target.workspaceId)
					.find(
						(tab) => tab.browserId !== target.browserId && tab.presented && tab.phase === "ready"
					)
			);
			assert.equal(linked.agentControl, false);
			const child = await guestFor(linked.browserId);
			assert.equal(child.session, guest.session);
			await js("window.browserFixture.selectOriginal()");
			await wait("original tab restored", () => service.state(target).presented);
			await js(`window.browserFixture.closeTab(${JSON.stringify(linked.browserId)})`);
			await wait("linked tab destroyed", () => child.isDestroyed());
			await service.command(target, { kind: "agent-control", enabled: true });
			await service.command(target, { kind: "navigate", url: url.replace("/one", "/two") });
			await service.command(target, { kind: "back" });
			assert.equal(service.state(target).url, url);
			await service.command(target, { kind: "forward" });
			await service.command(target, { kind: "reload" });
			checks.push("linked tabs, history and reload use registered guests");
			recoveryServer = createServer((_req, res) =>
				res.end("<title>Recovered website</title><h1>Recovered website</h1>")
			);
			await new Promise((resolve) => recoveryServer.listen(0, "127.0.0.1", resolve));
			const recoveryPort = recoveryServer.address().port;
			await new Promise((resolve) => recoveryServer.close(resolve));
			const unavailableUrl = `http://127.0.0.1:${recoveryPort}/recover`;
			await service.command(target, { kind: "navigate", url: unavailableUrl });
			assert.equal(service.state(target).loadError.code, -102);
			await wait("failure overlay", () => js("!!document.querySelector('[data-browser-retry]')"));
			await new Promise((resolve) => recoveryServer.listen(recoveryPort, "127.0.0.1", resolve));
			await js("document.querySelector('[data-browser-retry]').click()");
			await wait(
				"real retry",
				() => service.state(target).title === "Recovered website" && !service.state(target).error
			);
			await service.command(target, { kind: "navigate", url });
			assert.equal(service.state(target).error, null);
			checks.push("failure overlay and Retry recover a real refused connection");
			await service.command(target, { kind: "agent-control", enabled: false });
			const crashedId = guest.id;
			guest.forcefullyCrashRenderer();
			await wait("crash recovery action", () =>
				js(
					"[...document.querySelectorAll('button')].some(button=>button.textContent==='Reopen browser')"
				)
			);
			await js(
				"[...document.querySelectorAll('button')].find(button=>button.textContent==='Reopen browser').click()"
			);
			await wait("crash replacement attached", () => {
				try {
					return (
						service.state(target).phase === "ready" &&
						!service.state(target).loading &&
						service.state(target).presented
					);
				} catch {
					return false;
				}
			});
			guest = await guestFor(target.browserId);
			assert.notEqual(guest.id, crashedId);
			assert.equal(service.state(target).agentControl, false);
			await service.command(target, { kind: "agent-control", enabled: true });
			checks.push("guest crash recovery preserves pause state and replaces its registration");
			await guest.executeJavaScript("localStorage.setItem('profile-proof','retained')");
			guest.session.flushStorageData();
			await guest.session.cookies.flushStore();
			const png = Buffer.from(await service.screenshot(target), "base64");
			assert.ok(png.length > 1000);
			fs.writeFileSync(join(directory, "browser.png"), png);
			checks.push("frame-ready screenshot of the registered guest");
			// The renderer cannot attach an unreserved guest or forge another reservation.
			const reservation = runtime.reserve(
				{ ...target, url, viewport: "desktop" },
				window.webContents.id
			);
			assert.throws(
				() =>
					runtime.register(
						{ ...target, generation: "stale", webContentsId: guest.id },
						window.webContents.id
					),
				/authorized/
			);
			assert.throws(
				() =>
					runtime.register(
						{ ...target, generation: reservation.generation, webContentsId: window.webContents.id },
						window.webContents.id
					),
				/authorized/
			);
			checks.push("attachment generations and host ownership enforced");
		}
		if (process.env.BROWSER_SMOKE_URL) {
			if (process.env.BROWSER_SMOKE_INPUT) await enterAddress(process.env.BROWSER_SMOKE_INPUT);
			else await service.command(target, { kind: "navigate", url: process.env.BROWSER_SMOKE_URL });
			await wait("public page ready", () => {
				const state = service.state(target);
				const actual = new URL(state.url || "about:blank");
				const expected = new URL(process.env.BROWSER_SMOKE_URL);
				return (
					actual.origin === expected.origin &&
					actual.pathname === expected.pathname &&
					[...expected.searchParams].every(
						([key, value]) => actual.searchParams.get(key) === value
					) &&
					!state.loading &&
					!state.error
				);
			});
			window.setTitle(`SuperiorSwarm webview verification — Electron ${process.versions.electron}`);
			fs.writeFileSync(
				join(directory, "live-browser-ready.json"),
				JSON.stringify({
					title: guest.getTitle(),
					url: guest.getURL(),
					runtime: process.versions.electron,
					guest: guest.getType(),
				})
			);
			await new Promise((resolve) =>
				setTimeout(resolve, Math.min(45000, Number(process.env.BROWSER_SMOKE_HOLD_MS || 0)))
			);
		}
		await js("window.browserFixture.close()");
		await wait("guest destroyed", () => guest.isDestroyed());
		checks.push("explicit tab removal destroys the guest");
		runtime.dispose();
		window.destroy();
		server.close();
		recoveryServer?.close();
		clearTimeout(deadline);
		console.log(JSON.stringify({ checks, electron: process.versions.electron }));
		app.exit(0);
	} catch (error) {
		console.error(error);
		if (window && !window.isDestroyed())
			try {
				console.error(
					"DIAGNOSTICS",
					await window.webContents.executeJavaScript(
						"JSON.stringify({body:document.body.innerText,guests:[...document.querySelectorAll('webview')].map(v=>({src:v.getAttribute('src'),rect:v.getBoundingClientRect().toJSON()}))})"
					)
				);
			} catch {}
		runtime?.dispose();
		window?.destroy();
		server?.close();
		recoveryServer?.close();
		clearTimeout(deadline);
		app.exit(1);
	}
});
