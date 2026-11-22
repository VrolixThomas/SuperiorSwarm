import { createHash, randomUUID } from "node:crypto";
import { type BrowserWindow, type Session, type WebContents, session, webContents } from "electron";
import {
	type BrowserBounds,
	type BrowserCommand,
	type BrowserReservation,
	type BrowserSnapshot,
	type BrowserStateEvent,
	type BrowserTab,
	type BrowserTarget,
	isBrowserURL,
} from "../../shared/browser";
import { type BrowserLoadError, describeBrowserLoadError } from "../../shared/browser-load-error";
import { browserActionScript, browserSnapshotScript } from "./dom";
import { requestLinkedBrowserTab } from "./open-tab";
import { allowedBrowserRequest, isBrowserTabRequest } from "./policy";
import { type BrowserPage, BrowserService } from "./service";

export function workspaceBrowserPartition(workspaceId: string): string {
	return `persist:superiorswarm-browser-${createHash("sha256").update(workspaceId).digest("hex").slice(0, 32)}`;
}

/** Main owns authority and sessions; the renderer owns persistent DOM webviews. */
export class BrowserGuestRuntime {
	readonly service: BrowserService;
	private pages = new Map<string, GuestPage>();
	private profiles = new Map<string, Session>();
	constructor(private readonly getWindow: () => BrowserWindow | null) {
		this.service = new BrowserService(
			(tab) => {
				const window = this.getWindow();
				if (!window || window.isDestroyed()) throw new Error("Application window unavailable.");
				const page = new GuestPage(tab, window.webContents.id, this.profile(tab.workspaceId), {
					change: () => this.publish(tab),
					input: () => this.service.invalidateAgent(tab),
					openTab: (url, background) =>
						requestLinkedBrowserTab(this.service, tab, url, background, (next) =>
							window.webContents.send("browser:open-tab", next)
						),
					shortcut: (kind) => {
						window.webContents.send("browser:shortcut", { browserId: tab.browserId, kind });
						if (kind !== "focus") window.webContents.focus();
					},
				});
				this.pages.set(tab.browserId, page);
				return page;
			},
			(target, state) => {
				const page = this.pages.get(target.browserId);
				if (!page) return;
				this.send({ ...target, generation: page.reservation.generation, state });
				if (!state && this.pages.get(target.browserId) === page)
					this.pages.delete(target.browserId);
			}
		);
	}
	private send(event: BrowserStateEvent) {
		const window = this.getWindow();
		if (window && !window.isDestroyed() && !window.webContents.isDestroyed())
			window.webContents.send("browser:state", event);
	}
	private publish(target: BrowserTarget) {
		const page = this.pages.get(target.browserId);
		if (page && !page.closed)
			this.send({
				...target,
				generation: page.reservation.generation,
				state: this.service.state(target),
			});
	}
	private profile(workspaceId: string) {
		const partition = workspaceBrowserPartition(workspaceId);
		let profile = this.profiles.get(partition);
		if (!profile) {
			profile = session.fromPartition(partition);
			profile.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
			profile.setPermissionCheckHandler(() => false);
			profile.setDevicePermissionHandler(() => false);
			profile.webRequest.onBeforeRequest((details, callback) =>
				callback({ cancel: !allowedBrowserRequest(details.url) })
			);
			profile.on("will-download", (event) => event.preventDefault());
			this.profiles.set(partition, profile);
		}
		return profile;
	}
	reserve(tab: BrowserTab & { agentControl?: boolean }, senderId: number) {
		const window = this.getWindow();
		if (!window || window.webContents.id !== senderId)
			throw new Error("Browser reservation requires the app window.");
		const state = this.service.ensure(tab, true, tab.agentControl ?? true);
		const page = this.pages.get(tab.browserId);
		if (!page) throw new Error("Browser reservation unavailable.");
		return { ...page.reservation, state };
	}
	register(
		target: BrowserTarget & { generation: string; webContentsId: number },
		senderId: number
	) {
		const page = this.pages.get(target.browserId);
		const guest = webContents.fromId(target.webContentsId);
		if (
			!page ||
			page.closed ||
			page.tab.workspaceId !== target.workspaceId ||
			page.reservation.generation !== target.generation ||
			page.ownerId !== senderId ||
			!guest ||
			guest.isDestroyed() ||
			guest.getType() !== "webview" ||
			guest.hostWebContents?.id !== senderId ||
			guest.session !== page.profile
		)
			throw new Error("Browser guest registration is not authorized or has expired.");
		if ([...this.pages.values()].some((other) => other !== page && other.contents === guest))
			throw new Error("Browser guest is already assigned to another tab.");
		page.attach(guest);
		return this.service.state(target);
	}
	install(window: BrowserWindow) {
		window.webContents.on("will-attach-webview", (event, preferences, params) => {
			if (
				params["src"] !== "about:blank" ||
				![...this.pages.values()].some(
					(page) =>
						!page.closed &&
						page.ownerId === window.webContents.id &&
						page.reservation.partition === params["partition"]
				)
			) {
				event.preventDefault();
				return;
			}
			// The website never receives the app preload, Node, or another embedded guest.
			Reflect.deleteProperty(preferences, "preload");
			preferences.nodeIntegration = false;
			preferences.nodeIntegrationInSubFrames = false;
			preferences.contextIsolation = true;
			preferences.sandbox = true;
			preferences.webSecurity = true;
			preferences.allowRunningInsecureContent = false;
			preferences.webviewTag = false;
		});
	}
	dispose() {
		this.service.dispose();
	}
}

interface GuestCallbacks {
	change(): void;
	input(): void;
	openTab(url: string, background: boolean): unknown;
	shortcut(kind: "address" | "close" | "palette" | "focus"): void;
}

class GuestPage implements BrowserPage {
	readonly reservation: BrowserReservation;
	contents: WebContents | null = null;
	closed = false;
	private phase: "attaching" | "ready" | "crashed" = "attaching";
	private bounds: BrowserBounds | null = null;
	private error: string | null = null;
	private loadError: BrowserLoadError | null = null;
	private requestedUrl = "";
	private navigation = 0;
	private explicitStart: { url: string; generation: number } | null = null;
	private popups = new Set<BrowserWindow>();
	private resolve!: (contents: WebContents) => void;
	private reject!: (error: Error) => void;
	private ready = new Promise<WebContents>((resolve, reject) => {
		this.resolve = resolve;
		this.reject = reject;
	});
	constructor(
		readonly tab: BrowserTab,
		readonly ownerId: number,
		readonly profile: Session,
		private readonly callbacks: GuestCallbacks
	) {
		this.reservation = {
			workspaceId: tab.workspaceId,
			browserId: tab.browserId,
			generation: randomUUID(),
			partition: workspaceBrowserPartition(tab.workspaceId),
		};
		void this.ready.catch(() => {});
	}
	private notify() {
		if (!this.closed) this.callbacks.change();
	}
	private async getContents() {
		const contents = await this.ready;
		if (this.closed || contents.isDestroyed()) throw new Error("Browser tab closed.");
		if (this.phase === "crashed")
			throw new Error("Browser page stopped. Reopen the page to recover.");
		return contents;
	}
	private begin(url: string) {
		if (!isBrowserURL(url)) return;
		this.requestedUrl = new URL(url).href;
		this.loadError = null;
		this.error = null;
		this.navigation++;
		this.notify();
	}
	attach(contents: WebContents) {
		if (this.contents === contents) return;
		if (this.contents) throw new Error("Browser reservation is already attached.");
		this.contents = contents;
		this.phase = "ready";
		contents.setBackgroundThrottling(!this.bounds);
		this.guard(contents);
		contents.setWindowOpenHandler((details) => this.windowOpen(details));
		contents.on("did-create-window", (popup) => this.configurePopup(popup));
		contents.on("did-start-navigation", (_event, url, inPlace, mainFrame) => {
			if (!mainFrame || inPlace) return;
			if (this.explicitStart?.generation === this.navigation && this.explicitStart.url === url)
				this.explicitStart = null;
			else {
				this.explicitStart = null;
				this.begin(url);
			}
		});
		contents.on("did-redirect-navigation", (_event, url, _inPlace, mainFrame) => {
			if (mainFrame && isBrowserURL(url)) this.requestedUrl = url;
		});
		contents.on("did-navigate", (_event, url) => {
			if (isBrowserURL(url)) {
				this.requestedUrl = url;
				this.loadError = null;
				this.error = null;
				this.notify();
			}
		});
		contents.on("did-navigate-in-page", (_event, url, mainFrame) => {
			if (mainFrame && isBrowserURL(url)) {
				this.requestedUrl = url;
				this.notify();
			}
		});
		contents.on("did-fail-load", (_event, code, _description, url, mainFrame) => {
			if (
				!mainFrame ||
				code === -3 ||
				!isBrowserURL(url) ||
				(this.requestedUrl && new URL(url).href !== this.requestedUrl)
			)
				return;
			this.loadError = describeBrowserLoadError(code, url);
			this.error = this.loadError.message;
			this.notify();
		});
		contents.on("did-start-loading", () => this.notify());
		contents.on("did-stop-loading", () => this.notify());
		contents.on("page-title-updated", () => this.notify());
		contents.on("render-process-gone", () => {
			this.phase = "crashed";
			this.error = "The browser page stopped. Reopen it to recover.";
			this.notify();
		});
		contents.on("destroyed", () => {
			if (!this.closed) {
				this.phase = "crashed";
				this.error = "Browser guest disconnected. Reopen it to recover.";
				this.notify();
			}
		});
		contents.on("before-input-event", (event, input) => {
			if (input.type !== "keyDown" || this.closed) return;
			this.callbacks.input();
			this.callbacks.shortcut("focus");
			if (!(input.meta || input.control)) return;
			const key = input.key.toLowerCase();
			if (["l", "w", "k"].includes(key)) {
				event.preventDefault();
				this.callbacks.shortcut(key === "l" ? "address" : key === "w" ? "close" : "palette");
			} else if (key === "r") {
				event.preventDefault();
				void this.command({ kind: "reload" }).catch(() => {});
			}
		});
		contents.on("before-mouse-event", (_event, mouse) => {
			if (!this.closed && (mouse.type === "mouseDown" || mouse.type === "mouseWheel")) {
				this.callbacks.input();
				if (mouse.type === "mouseDown") this.callbacks.shortcut("focus");
			}
		});
		this.resolve(contents);
		this.notify();
	}
	private guard(contents: WebContents) {
		const allowed = (url: string) => url === "about:blank" || isBrowserURL(url);
		contents.on("will-navigate", (event, url) => {
			if (!allowed(url)) event.preventDefault();
		});
		contents.on("will-redirect", (event, url) => {
			if (!allowed(url)) event.preventDefault();
		});
		contents.on("will-frame-navigate", (event) => {
			if (!allowed(event.url) && event.url !== "about:srcdoc") event.preventDefault();
		});
		contents.on("will-attach-webview", (event) => event.preventDefault());
	}
	private windowOpen(details: Electron.HandlerDetails): Electron.WindowOpenHandlerResponse {
		if (this.closed || !this.bounds) return { action: "deny" };
		const url = details.url;
		const allowed = url === "about:blank" || isBrowserURL(url);
		if (!allowed) return { action: "deny" };
		const parsed = new URL(url);
		const oauth =
			parsed.searchParams.has("client_id") &&
			(parsed.searchParams.has("redirect_uri") || parsed.searchParams.has("response_type"));
		if (
			details.disposition === "new-window" ||
			url === "about:blank" ||
			oauth ||
			details.postBody
		) {
			if (this.popups.size >= 4) return { action: "deny" };
			// Inherit the guest's sandbox/session unchanged to preserve window.opener.
			return {
				action: "allow",
				outlivesOpener: false,
				overrideBrowserWindowOptions: { autoHideMenuBar: true, fullscreenable: false },
			};
		}
		if (isBrowserTabRequest(details)) {
			try {
				this.callbacks.openTab(url, details.disposition === "background-tab");
			} catch {
				this.error = "Could not open another browser tab. Close an unused tab and retry.";
				this.notify();
			}
		}
		return { action: "deny" };
	}
	private configurePopup(popup: BrowserWindow) {
		this.popups.add(popup);
		this.guard(popup.webContents);
		popup.webContents.setWindowOpenHandler((details) => this.windowOpen(details));
		popup.webContents.on("did-create-window", (child) => this.configurePopup(child));
		popup.on("closed", () => this.popups.delete(popup));
	}
	state() {
		const wc = this.contents && !this.contents.isDestroyed() ? this.contents : null;
		return {
			phase: this.phase,
			url: this.requestedUrl || (wc && isBrowserURL(wc.getURL()) ? wc.getURL() : ""),
			title: wc?.getTitle() || "Browser",
			loading: !this.loadError && (wc?.isLoadingMainFrame() ?? Boolean(this.tab.url)),
			canGoBack: wc?.navigationHistory.canGoBack() ?? false,
			canGoForward: wc?.navigationHistory.canGoForward() ?? false,
			error: this.error,
			loadError: this.loadError,
		};
	}
	async navigate(value: string) {
		const wc = await this.getContents();
		if (!isBrowserURL(value)) throw new Error("HTTPS or localhost HTTP required.");
		const url = new URL(value).href;
		this.begin(url);
		const current = this.navigation;
		this.explicitStart = { url, generation: current };
		try {
			await wc.loadURL(url);
			if (!this.closed && current === this.navigation) {
				this.loadError = null;
				this.error = null;
			}
		} catch (cause) {
			if (this.closed || current !== this.navigation || this.loadError) return;
			const code =
				typeof (cause as { errno?: unknown }).errno === "number"
					? (cause as { errno: number }).errno
					: -2;
			if (code !== -3) {
				this.loadError = describeBrowserLoadError(code, this.requestedUrl || url);
				this.error = this.loadError.message;
			}
		} finally {
			if (this.explicitStart?.generation === current) this.explicitStart = null;
			this.notify();
		}
	}
	async command(command: BrowserCommand) {
		const wc = await this.getContents();
		if (command.kind === "stop") {
			wc.stop();
			this.notify();
			return;
		}
		if (command.kind === "clear-data") {
			await this.profile.clearStorageData();
			await this.profile.clearCache();
			await this.profile.cookies.flushStore();
			wc.reload();
		}
		if (command.kind === "back" && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
		if (command.kind === "forward" && wc.navigationHistory.canGoForward())
			wc.navigationHistory.goForward();
		if (command.kind === "reload") {
			if (this.loadError) await this.navigate(this.loadError.url);
			else wc.reload();
		}
		await this.settle();
		this.notify();
	}
	present(bounds: BrowserBounds | null) {
		this.bounds = bounds;
		if (this.contents && !this.contents.isDestroyed())
			this.contents.setBackgroundThrottling(!bounds);
	}
	private async settle() {
		const wc = await this.getContents();
		do {
			await new Promise((resolve) => setTimeout(resolve, 32));
			if (this.closed || wc.isDestroyed()) throw new Error("Browser closed.");
		} while (wc.isLoadingMainFrame());
		return wc;
	}
	async snapshot() {
		const wc = await this.settle();
		return (await wc.executeJavaScriptInIsolatedWorld(999, [
			{ code: browserSnapshotScript },
		])) as BrowserSnapshot;
	}
	async act(action: object, snapshot: BrowserSnapshot) {
		const wc = await this.getContents();
		await wc.executeJavaScriptInIsolatedWorld(
			999,
			[{ code: browserActionScript(action, JSON.stringify(snapshot)) }],
			true
		);
		await this.settle();
	}
	async screenshot() {
		const wc = await this.settle();
		wc.setBackgroundThrottling(false);
		try {
			await wc.executeJavaScript(
				"new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))"
			);
			let capture = await wc.capturePage();
			if (capture.isEmpty()) throw new Error("Browser screenshot is unavailable.");
			if (capture.getSize().width > 1600) capture = capture.resize({ width: 1600 });
			const png = capture.toPNG();
			if (png.length > 6 * 1024 * 1024)
				throw new Error("Screenshot too large. Resize the pane and retry.");
			return png.toString("base64");
		} finally {
			if (!wc.isDestroyed()) wc.setBackgroundThrottling(!this.bounds);
		}
	}
	close() {
		if (this.closed) return;
		this.closed = true;
		this.reject(new Error("Browser reservation closed."));
		for (const popup of this.popups) if (!popup.isDestroyed()) popup.destroy();
		this.popups.clear();
		if (this.contents && !this.contents.isDestroyed())
			this.contents.close({ waitForBeforeUnload: false });
		void this.profile.cookies.flushStore().catch(() => {});
	}
}
