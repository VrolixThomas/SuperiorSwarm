import type {
	BrowserBounds,
	BrowserCommand,
	BrowserReservation,
	BrowserState,
	BrowserTab,
} from "../../shared/browser";
import { usePaneStore } from "../stores/pane-store";
import { useTabStore } from "../stores/tab-store";
import { trpcVanilla } from "../trpc/client";

interface GuestElement extends HTMLElement {
	getWebContentsId(): number;
}
interface Entry {
	tab: BrowserTab;
	state: BrowserState | null;
	reservation: BrowserReservation | null;
	webview: GuestElement | null;
	overlay: HTMLDivElement;
	placeholder: HTMLElement | null;
	closed: boolean;
	registering: boolean;
	closeTimer?: ReturnType<typeof setTimeout>;
}

/** Geometry comes from the pane slot, not document-wide overlap/hit-test heuristics. */
export function browserSlotBounds(element: HTMLElement): BrowserBounds | null {
	if (
		!element.isConnected ||
		document.hidden ||
		!element.checkVisibility({ checkVisibilityCSS: true })
	)
		return null;
	const rect = element.getBoundingClientRect();
	if (rect.width < 1 || rect.height < 1) return null;
	return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

/** One permanent DOM node per browser. Tab movement never reparents/reorders the guest. */
export class BrowserRuntimeRegistry {
	private entries = new Map<string, Entry>();
	private listeners = new Map<string, Set<() => void>>();
	private root: HTMLDivElement | null = null;
	private sequence = 0;
	private lastPresentation = "";
	private frame = 0;
	private running = false;
	private dragging = false;
	private stopTimer: ReturnType<typeof setTimeout> | undefined;
	private cleanup: (() => void) | null = null;
	private rootElement() {
		if (!this.root) {
			this.root = document.createElement("div");
			this.root.id = "workspace-browser-host";
			Object.assign(this.root.style, {
				position: "fixed",
				inset: "0",
				zIndex: "1",
				pointerEvents: "none",
			});
			document.body.append(this.root);
		}
		return this.root;
	}
	getState(id: string) {
		return this.entries.get(id)?.state ?? null;
	}
	getOverlay(id: string) {
		return this.entries.get(id)?.overlay ?? null;
	}
	subscribe(id: string, callback: () => void) {
		let set = this.listeners.get(id);
		if (!set) {
			set = new Set();
			this.listeners.set(id, set);
		}
		set.add(callback);
		return () => {
			set?.delete(callback);
			if (!set?.size) this.listeners.delete(id);
		};
	}
	private notify(id: string) {
		for (const callback of this.listeners.get(id) ?? []) callback();
	}
	private publish(entry: Entry, state: BrowserState) {
		if (entry.closed || this.entries.get(entry.tab.browserId) !== entry) return;
		entry.state = state;
		const pane = usePaneStore.getState().findPaneForTab(entry.tab.workspaceId, entry.tab.browserId);
		const tab = pane?.tabs.find((tab) => tab.id === entry.tab.browserId);
		if (
			tab?.kind === "browser" &&
			(tab.url !== (state.url || tab.url) ||
				tab.title !== state.title ||
				tab.viewport !== state.viewport)
		) {
			usePaneStore.getState().updateTabInPanes(tab.id, (current) =>
				current.kind === "browser"
					? {
							...current,
							url: state.url || current.url,
							title: state.title || "Browser",
							viewport: state.viewport,
						}
					: current
			);
		}
		this.notify(entry.tab.browserId);
	}
	private fail(entry: Entry, cause: unknown) {
		this.publish(entry, {
			...entry.tab,
			title: entry.state?.title ?? "Browser",
			loading: false,
			canGoBack: false,
			canGoForward: false,
			presented: false,
			agentControl: entry.state?.agentControl ?? true,
			phase: "crashed",
			error: cause instanceof Error ? cause.message : "Browser unavailable. Reopen the page.",
		});
	}
	private create(tab: BrowserTab, agentControl?: boolean): Entry {
		const overlay = document.createElement("div");
		overlay.dataset["browserOverlay"] = tab.browserId;
		Object.assign(overlay.style, {
			position: "fixed",
			pointerEvents: "none",
			display: "none",
			zIndex: "2",
		});
		const entry: Entry = {
			tab,
			overlay,
			state: null,
			webview: null,
			reservation: null,
			placeholder: null,
			closed: false,
			registering: false,
		};
		this.entries.set(tab.browserId, entry);
		this.rootElement().append(overlay);
		void trpcVanilla.browser.reserve
			.mutate({ ...tab, agentControl })
			.then((reservation) => {
				if (entry.closed) return;
				entry.reservation = reservation;
				this.publish(entry, reservation.state);
				const webview = document.createElement("webview") as GuestElement;
				entry.webview = webview;
				webview.dataset["browserGuest"] = tab.browserId;
				webview.setAttribute("partition", reservation.partition);
				webview.setAttribute(
					"webpreferences",
					"sandbox=true,contextIsolation=true,nodeIntegration=false"
				);
				webview.setAttribute("allowpopups", "");
				webview.setAttribute("src", "about:blank");
				Object.assign(webview.style, {
					position: "fixed",
					display: "flex",
					left: "-100000px",
					top: "0",
					width: "1024px",
					height: "768px",
					border: "0",
					background: "white",
					transformOrigin: "top left",
					pointerEvents: "none",
				});
				const register = async () => {
					if (entry.closed || entry.registering) return;
					let id: number;
					try {
						id = webview.getWebContentsId();
					} catch {
						return;
					}
					if (!id) return;
					entry.registering = true;
					try {
						this.publish(
							entry,
							await trpcVanilla.browser.register.mutate({
								...tab,
								generation: reservation.generation,
								webContentsId: id,
							})
						);
					} catch (error) {
						this.fail(entry, error);
					} finally {
						entry.registering = false;
					}
				};
				webview.addEventListener("did-attach", () => void register());
				webview.addEventListener("dom-ready", () => void register());
				webview.addEventListener("render-process-gone", () =>
					this.fail(entry, new Error("Browser page stopped. Reopen it to recover."))
				);
				// Both layers remain children of the same permanent root for their entire life.
				this.rootElement().append(webview);
				this.notify(tab.browserId);
			})
			.catch((error) => this.fail(entry, error));
		return entry;
	}
	attach(tab: BrowserTab, placeholder: HTMLElement) {
		const entry = this.entries.get(tab.browserId) ?? this.create(tab);
		if (entry.tab.workspaceId !== tab.workspaceId) throw new Error("Browser workspace mismatch.");
		entry.placeholder = placeholder;
		this.layout();
		return () => {
			if (entry.placeholder === placeholder) {
				entry.placeholder = null;
				this.layout();
			}
		};
	}
	async command(id: string, command: BrowserCommand) {
		const entry = this.entries.get(id);
		if (!entry || entry.closed) return;
		try {
			this.publish(entry, await trpcVanilla.browser.command.mutate({ ...entry.tab, command }));
		} catch (error) {
			this.fail(entry, error);
		}
	}
	async restart(id: string) {
		const entry = this.entries.get(id);
		if (!entry) return;
		const placeholder = entry.placeholder;
		const tab = {
			...entry.tab,
			url: entry.state?.url || entry.tab.url,
			viewport: entry.state?.viewport ?? entry.tab.viewport,
		};
		this.destroy(entry);
		await trpcVanilla.browser.close.mutate(tab);
		if (
			useTabStore
				.getState()
				.getTabsByWorkspace(tab.workspaceId)
				.some((item) => item.id === id)
		) {
			const replacement = this.create(tab, entry.state?.agentControl);
			replacement.placeholder = placeholder;
			this.notify(id);
		}
	}
	private destroy(entry: Entry) {
		entry.closed = true;
		clearTimeout(entry.closeTimer);
		entry.webview?.remove();
		entry.overlay.remove();
		if (this.entries.get(entry.tab.browserId) === entry) this.entries.delete(entry.tab.browserId);
		this.notify(entry.tab.browserId);
	}
	private reconcile() {
		const tabs = useTabStore
			.getState()
			.getAllTabs()
			.filter((tab) => tab.kind === "browser");
		const wanted = new Set(tabs.map((tab) => tab.id));
		for (const entry of this.entries.values()) {
			if (wanted.has(entry.tab.browserId)) {
				clearTimeout(entry.closeTimer);
				entry.closeTimer = undefined;
			} else if (!entry.closeTimer)
				entry.closeTimer = setTimeout(() => {
					if (
						!useTabStore
							.getState()
							.getAllTabs()
							.some((tab) => tab.id === entry.tab.browserId)
					) {
						this.destroy(entry);
						void trpcVanilla.browser.close.mutate(entry.tab).catch(() => {});
					}
				}, 300);
		}
		for (const tab of tabs)
			if (!this.entries.has(tab.id))
				this.create({
					workspaceId: tab.workspaceId,
					browserId: tab.id,
					url: tab.url,
					viewport: tab.viewport,
				});
	}
	private layout() {
		const presentations: Array<BrowserTab & { bounds: BrowserBounds }> = [];
		const blocked = [
			...document.querySelectorAll<HTMLElement>(
				'dialog[open],[aria-modal="true"],[role="dialog"],[role="menu"],[data-browser-modal]'
			),
		].some((element) => element.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true }));
		for (const entry of this.entries.values()) {
			const bounds = entry.placeholder ? browserSlotBounds(entry.placeholder) : null;
			if (!bounds) {
				if (entry.webview)
					Object.assign(entry.webview.style, { left: "-100000px", pointerEvents: "none" });
				entry.overlay.style.display = "none";
				continue;
			}
			if (!blocked && !this.dragging) presentations.push({ ...entry.tab, bounds });
			const phone = (entry.state?.viewport ?? entry.tab.viewport) === "phone";
			const scale = phone ? Math.min(1, bounds.width / 390, bounds.height / 844) : 1;
			const width = phone ? 390 : bounds.width;
			const height = phone ? 844 : bounds.height;
			// Clip to the pane and its overflow ancestors; no global overlay scans.
			let left = Math.max(0, bounds.x);
			let top = Math.max(0, bounds.y);
			let right = Math.min(innerWidth, bounds.x + bounds.width);
			let bottom = Math.min(innerHeight, bounds.y + bounds.height);
			for (let parent = entry.placeholder?.parentElement; parent; parent = parent.parentElement) {
				const style = getComputedStyle(parent);
				const box = parent.getBoundingClientRect();
				if (style.overflowX !== "visible") {
					left = Math.max(left, box.left);
					right = Math.min(right, box.right);
				}
				if (style.overflowY !== "visible") {
					top = Math.max(top, box.top);
					bottom = Math.min(bottom, box.bottom);
				}
			}
			if (right <= left || bottom <= top) {
				if (!blocked && !this.dragging) presentations.pop();
				if (entry.webview) entry.webview.style.left = "-100000px";
				entry.overlay.style.display = "none";
				continue;
			}
			const x = bounds.x + (bounds.width - width * scale) / 2;
			const y = bounds.y + (bounds.height - height * scale) / 2;
			if (entry.webview)
				Object.assign(entry.webview.style, {
					left: `${x}px`,
					top: `${y}px`,
					width: `${width}px`,
					height: `${height}px`,
					transform: `scale(${scale})`,
					clipPath: `inset(${Math.max(0, top - y) / scale}px ${Math.max(0, x + width * scale - right) / scale}px ${Math.max(0, y + height * scale - bottom) / scale}px ${Math.max(0, left - x) / scale}px)`,
					pointerEvents:
						this.dragging || entry.state?.loadError || entry.state?.phase === "crashed"
							? "none"
							: "auto",
				});
			Object.assign(entry.overlay.style, {
				display: "flex",
				left: `${bounds.x}px`,
				top: `${bounds.y}px`,
				width: `${bounds.width}px`,
				height: `${bounds.height}px`,
				clipPath: `inset(${Math.max(0, top - bounds.y)}px ${Math.max(0, bounds.x + bounds.width - right)}px ${Math.max(0, bounds.y + bounds.height - bottom)}px ${Math.max(0, left - bounds.x)}px)`,
			});
		}
		const tabs = [...this.entries.values()].map((entry) => ({
			workspaceId: entry.tab.workspaceId,
			browserId: entry.tab.browserId,
		}));
		const key = JSON.stringify({ tabs, presentations });
		if (key !== this.lastPresentation) {
			this.lastPresentation = key;
			void trpcVanilla.browser.sync
				.mutate({ sequence: ++this.sequence, tabs, presentations })
				.catch(() => {
					if (this.lastPresentation === key) this.lastPresentation = "";
				});
		}
	}
	start() {
		clearTimeout(this.stopTimer);
		if (this.running) return;
		this.running = true;
		const offState = window.electron.browser.onState((event) => {
			const entry = this.entries.get(event.browserId);
			if (
				!entry ||
				!entry.reservation ||
				entry.reservation.generation !== event.generation ||
				entry.tab.workspaceId !== event.workspaceId
			)
				return;
			if (event.state) this.publish(entry, event.state);
			else this.fail(entry, new Error("Browser disconnected. Reopen it to recover."));
		});
		const onDrag = () => {
			this.dragging = true;
			this.layout();
		};
		const onEnd = () => {
			this.dragging = false;
			this.layout();
		};
		const onPointer = (event: PointerEvent) => {
			if ((event.target as Element)?.closest?.('[role="separator"],[data-separator]')) onDrag();
		};
		document.addEventListener("dragstart", onDrag, true);
		document.addEventListener("dragend", onEnd, true);
		document.addEventListener("drop", onEnd, true);
		document.addEventListener("pointerdown", onPointer, true);
		document.addEventListener("pointerup", onEnd, true);
		const onVisibility = () => this.layout();
		document.addEventListener("visibilitychange", onVisibility);
		window.addEventListener("resize", onVisibility);
		const offStore = usePaneStore.subscribe(() => this.reconcile());
		this.cleanup = () => {
			document.removeEventListener("visibilitychange", onVisibility);
			window.removeEventListener("resize", onVisibility);
			offState();
			offStore();
			document.removeEventListener("dragstart", onDrag, true);
			document.removeEventListener("dragend", onEnd, true);
			document.removeEventListener("drop", onEnd, true);
			document.removeEventListener("pointerdown", onPointer, true);
			document.removeEventListener("pointerup", onEnd, true);
		};
		this.reconcile();
		const tick = () => {
			if (!this.running) return;
			this.layout();
			this.frame = requestAnimationFrame(tick);
		};
		tick();
	}
	stop() {
		// StrictMode and same-commit remounts hand ownership to the successor.
		this.stopTimer = setTimeout(() => {
			this.running = false;
			cancelAnimationFrame(this.frame);
			this.cleanup?.();
			this.cleanup = null;
			for (const entry of this.entries.values()) this.destroy(entry);
			this.root?.remove();
			this.root = null;
			this.lastPresentation = "";
			void trpcVanilla.browser.sync
				.mutate({ sequence: ++this.sequence, tabs: [], presentations: [] })
				.catch(() => {});
		}, 0);
	}
}
export const browserRegistry = new BrowserRuntimeRegistry();
