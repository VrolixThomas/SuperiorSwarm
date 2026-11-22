import type {
	BrowserAction,
	BrowserBounds,
	BrowserCommand,
	BrowserObservation,
	BrowserSnapshot,
	BrowserState,
	BrowserSync,
	BrowserTab,
	BrowserTarget,
} from "../../shared/browser";

export interface BrowserPage {
	state(): Pick<
		BrowserState,
		"url" | "title" | "loading" | "canGoBack" | "canGoForward" | "error" | "loadError" | "phase"
	>;
	navigate(url: string): Promise<void>;
	command(command: BrowserCommand): Promise<void>;
	present(bounds: BrowserBounds | null, viewport: BrowserTab["viewport"]): void;
	snapshot(): Promise<BrowserSnapshot>;
	act(action: BrowserAction, snapshot: BrowserSnapshot): Promise<void>;
	screenshot(): Promise<string>;
	close(): void;
}
interface Entry {
	onClose: Set<() => void>;
	tab: BrowserTab;
	page: BrowserPage;
	adopted: boolean;
	agentControl: boolean;
	agentEpoch: number;
	bounds: BrowserBounds | null;
	sequence: number;
	fingerprint?: string;
	tail: Promise<unknown>;
	pending: number;
	closed: boolean;
}

/** Native pages outlive renderer components. Every lookup checks both ownership keys. */
export class BrowserService {
	private entries = new Map<string, Entry>();
	private layoutSequence = -1;
	private presentations = new Map<string, BrowserBounds>();
	constructor(
		private readonly createPage: (tab: BrowserTab) => BrowserPage,
		private readonly onChange: (
			target: BrowserTarget,
			state: BrowserState | null
		) => void = () => {}
	) {}
	private changed(target: BrowserTarget): BrowserState {
		const state = this.state(target);
		this.onChange(target, state);
		return state;
	}
	ensure(tab: BrowserTab, adopted = true, agentControl = true): BrowserState {
		let entry = this.entries.get(tab.browserId);
		if (entry && entry.tab.workspaceId !== tab.workspaceId)
			throw new Error("Browser belongs to another workspace.");
		if (!entry) {
			if (this.entries.size >= 32)
				throw new Error("Close a browser tab before opening another (limit: 32).");
			entry = {
				onClose: new Set(),
				tab: { ...tab },
				page: this.createPage(tab),
				adopted,
				agentControl,
				agentEpoch: 0,
				bounds: this.presentations.get(tab.browserId) ?? null,
				sequence: 0,
				tail: Promise.resolve(),
				pending: 0,
				closed: false,
			};
			this.entries.set(tab.browserId, entry);
			entry.page.present(entry.bounds, tab.viewport);
			if (tab.url)
				void this.run(tab, async (entry) => {
					await entry.page.navigate(tab.url);
				}).catch(() => {});
		} else if (adopted) entry.adopted = true;
		return this.changed(tab);
	}
	private entry(target: BrowserTarget): Entry {
		const entry = this.entries.get(target.browserId);
		if (!entry || entry.closed || entry.tab.workspaceId !== target.workspaceId)
			throw new Error("Browser tab is unavailable in this workspace.");
		return entry;
	}
	state(target: BrowserTarget): BrowserState {
		const entry = this.entry(target);
		const page = entry.page.state();
		return {
			...entry.tab,
			...page,
			agentControl: entry.agentControl,
			presented:
				entry.bounds !== null &&
				!page.loadError &&
				page.phase !== "crashed" &&
				page.phase !== "attaching",
		};
	}
	list(workspaceId: string): BrowserState[] {
		return [...this.entries.values()]
			.filter((e) => e.tab.workspaceId === workspaceId)
			.map((e) => this.state(e.tab));
	}
	sync(input: BrowserSync): void {
		if (input.sequence <= this.layoutSequence) return;
		this.layoutSequence = input.sequence;
		const tabs = new Map(input.tabs.map((t) => [t.browserId, t.workspaceId]));
		this.presentations = new Map(
			input.presentations
				.filter((p) => tabs.get(p.browserId) === p.workspaceId)
				.map((p) => [p.browserId, p.bounds])
		);
		for (const entry of this.entries.values()) {
			if (entry.adopted && tabs.get(entry.tab.browserId) !== entry.tab.workspaceId) {
				this.close(entry.tab);
				continue;
			}
			if (tabs.get(entry.tab.browserId) === entry.tab.workspaceId) entry.adopted = true;
			const nextBounds =
				tabs.get(entry.tab.browserId) === entry.tab.workspaceId
					? (this.presentations.get(entry.tab.browserId) ?? null)
					: null;
			if (entry.bounds && !nextBounds) this.invalidateAgent(entry.tab);
			entry.bounds = nextBounds;
			entry.page.present(entry.bounds, entry.tab.viewport);
		}
	}
	invalidateAgent(target: BrowserTarget): void {
		const entry = this.entry(target);
		entry.agentEpoch++;
		entry.sequence++;
	}
	private agentReady(entry: Entry, epoch?: number): void {
		if (!entry.agentControl)
			throw new Error("Agent control is paused. The user can resume it in the browser toolbar.");
		if (!entry.bounds)
			throw new Error("Browser is hidden. Select its workspace and tab before using agent tools.");
		if (epoch !== undefined && epoch !== entry.agentEpoch)
			throw new Error("Browser control changed. Observe again before continuing.");
	}
	private async run<T>(
		target: BrowserTarget,
		work: (entry: Entry) => Promise<T>,
		agent = false
	): Promise<T> {
		const entry = this.entry(target);
		if (entry.pending >= 16) throw new Error("Browser is busy. Wait for the current operation.");
		const agentEpoch = entry.agentEpoch;
		if (agent) this.agentReady(entry);
		entry.pending++;
		const task = entry.tail
			.catch(() => {})
			.then(async () => {
				if (this.entry(target) !== entry) throw new Error("Browser tab was replaced.");
				if (agent) this.agentReady(entry, agentEpoch);
				let timer: ReturnType<typeof setTimeout> | undefined;
				let onClose = () => {};
				const cancelled = new Promise<never>((_resolve, reject) => {
					onClose = () => reject(new Error("Browser tab was closed or replaced."));
					entry.onClose.add(onClose);
				});
				try {
					const result = await Promise.race([
						work(entry),
						cancelled,
						new Promise<never>((_, reject) => {
							timer = setTimeout(() => {
								reject(new Error("Browser operation timed out. Reopen the tab to continue."));
								if (this.entries.get(target.browserId) === entry) this.close(target);
							}, 20000);
						}),
					]);
					if (this.entry(target) !== entry) throw new Error("Browser tab was replaced.");
					if (agent) this.agentReady(entry, agentEpoch);
					return result;
				} finally {
					clearTimeout(timer);
					entry.onClose.delete(onClose);
				}
			});
		entry.tail = task.finally(() => {
			entry.pending--;
		});
		// Keep a rejected operation from becoming an unhandled tail rejection.
		void entry.tail.catch(() => {});
		return task;
	}
	async command(
		target: BrowserTarget,
		command: BrowserCommand,
		agent = false
	): Promise<BrowserState> {
		// Manual controls revoke outstanding agent work before joining the page queue.
		if (!agent) this.invalidateAgent(target);
		// Stop/takeover cannot wait behind a hung website operation.
		if (command.kind === "agent-control") {
			if (agent) throw new Error("Only the user can change agent control.");
			this.entry(target).agentControl = command.enabled;
			return this.changed(target);
		}
		if (command.kind === "stop") {
			await this.entry(target).page.command(command);
			return this.changed(target);
		}
		return this.run(
			target,
			async (entry) => {
				if (command.kind === "viewport") {
					entry.tab.viewport = command.viewport;
					entry.page.present(entry.bounds, command.viewport);
				} else if (command.kind === "navigate") await entry.page.navigate(command.url);
				else await entry.page.command(command);
				return this.changed(target);
			},
			agent
		);
	}
	private async capture(entry: Entry): Promise<BrowserObservation> {
		const failure = entry.page.state().loadError;
		if (failure) throw new Error(failure.message);
		const snapshot = await entry.page.snapshot();
		const fingerprint = JSON.stringify(snapshot);
		if (fingerprint !== entry.fingerprint) {
			entry.sequence++;
			entry.fingerprint = fingerprint;
		}
		return {
			...snapshot,
			workspaceId: entry.tab.workspaceId,
			browserId: entry.tab.browserId,
			sequence: entry.sequence,
		};
	}
	observe(target: BrowserTarget): Promise<BrowserObservation> {
		return this.run(target, (entry) => this.capture(entry), true);
	}
	act(target: BrowserTarget, action: BrowserAction): Promise<BrowserObservation> {
		return this.run(
			target,
			async (entry) => {
				const epoch = entry.agentEpoch;
				const observation = await this.capture(entry);
				if (
					observation.sequence !== action.sequence ||
					observation.documentId !== action.documentId
				)
					throw new Error("Browser changed. Observe again before acting.");
				this.agentReady(entry, epoch);
				const {
					workspaceId: _workspace,
					browserId: _browser,
					sequence: _sequence,
					...snapshot
				} = observation;
				await entry.page.act(action, snapshot);
				return this.capture(entry);
			},
			true
		);
	}
	screenshot(target: BrowserTarget): Promise<string> {
		return this.run(
			target,
			(entry) => {
				const failure = entry.page.state().loadError;
				if (failure) throw new Error(failure.message);
				return entry.page.screenshot();
			},
			true
		);
	}
	close(target: BrowserTarget): void {
		const entry = this.entries.get(target.browserId);
		if (!entry || entry.tab.workspaceId !== target.workspaceId) return;
		entry.closed = true;
		for (const onClose of entry.onClose) onClose();
		entry.onClose.clear();
		this.entries.delete(target.browserId);
		entry.page.close();
		this.onChange(target, null);
	}
	closeUnadopted(target: BrowserTarget): void {
		const entry = this.entries.get(target.browserId);
		if (entry && !entry.adopted && entry.tab.workspaceId === target.workspaceId) this.close(target);
	}
	closeWorkspace(workspaceId: string): void {
		for (const entry of this.entries.values())
			if (entry.tab.workspaceId === workspaceId) this.close(entry.tab);
	}
	dispose(): void {
		for (const entry of this.entries.values()) this.close(entry.tab);
		this.presentations.clear();
		this.layoutSequence = -1;
	}
}
