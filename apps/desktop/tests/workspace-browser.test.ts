import { describe, expect, test } from "bun:test";
import { executeBrowserAgentRequest } from "../src/main/browser/agent";
import { requestLinkedBrowserTab } from "../src/main/browser/open-tab";
import { allowedBrowserRequest, isBrowserTabRequest } from "../src/main/browser/policy";
import { type BrowserPage, BrowserService } from "../src/main/browser/service";
import {
	type BrowserBounds,
	type BrowserSnapshot,
	type BrowserTab,
	browserAgentRequestSchema,
	isBrowserURL,
	normalizeBrowserURL,
} from "../src/shared/browser";
import { describeBrowserLoadError } from "../src/shared/browser-load-error";

const tab: BrowserTab = {
	workspaceId: "workspace-a",
	browserId: "browser-a",
	url: "",
	viewport: "desktop",
};
const bounds = { x: 100, y: 100, width: 800, height: 600 };
function fixture() {
	const pages: Array<
		BrowserPage & { closed: boolean; bounds: BrowserBounds | null; value: string; clicks: number }
	> = [];
	const service = new BrowserService(() => {
		let url = "";
		const page = {
			closed: false,
			bounds: null as BrowserBounds | null,
			value: "draft",
			clicks: 0,
			state: () => ({
				url,
				title: "Test page",
				loading: false,
				canGoBack: false,
				canGoForward: false,
				error: null,
			}),
			navigate: async (next: string) => {
				url = next;
			},
			command: async () => {},
			present: (next: BrowserBounds | null) => {
				page.bounds = next;
			},
			snapshot: async (): Promise<BrowserSnapshot> => ({
				url,
				title: "Test page",
				documentId: "doc-1",
				text: page.value,
				elements: [],
				scroll: { x: 0, y: 0 },
				truncated: false,
			}),
			act: async () => {
				page.clicks++;
			},
			screenshot: async () => "png",
			close: () => {
				page.closed = true;
			},
		};
		pages.push(page);
		return page;
	});
	service.ensure(tab);
	const show = (sequence = 1) =>
		service.sync({ sequence, tabs: [tab], presentations: [{ ...tab, bounds }] });
	const page = pages[0];
	if (!page) throw new Error("Fixture page missing");
	return { service, pages, show, page };
}

describe("workspace browser URL boundaries", () => {
	test("only ordinary GET tab links are admitted", () => {
		const link = { url: "https://example.com/next", disposition: "foreground-tab", features: "" };
		expect(isBrowserTabRequest(link)).toBe(true);
		expect(
			isBrowserTabRequest({
				...link,
				disposition: "background-tab",
				features: "noopener,noreferrer",
			})
		).toBe(true);
		for (const input of [
			{ ...link, url: "file:///tmp/secret" },
			{ ...link, disposition: "new-window" },
			{ ...link, postBody: {} },
			{ ...link, features: "width=600" },
		])
			expect(isBrowserTabRequest(input)).toBe(false);
	});
	test("normalizes local addresses and HTTPS without accepting privileged protocols", () => {
		expect(normalizeBrowserURL("localhost:5173/test")).toBe("http://localhost:5173/test");
		expect(normalizeBrowserURL("example.com")).toBe("https://example.com/");
		for (const url of [
			"file:///tmp/secret",
			"javascript:alert(1)",
			"https://user:pass@example.com",
			"http://example.com",
			"http://localhost.evil.test",
		])
			expect(isBrowserURL(url)).toBe(false);
		for (const url of [
			"https://example.com",
			"http://localhost:5173",
			"http://127.0.0.1:3000",
			"http://[::1]:3000",
		])
			expect(isBrowserURL(url)).toBe(true);
	});
	test("allows HMR WebSockets as requests but never as page navigation", () => {
		for (const url of ["ws://localhost:5173", "ws://127.0.0.1:3000", "wss://example.com/ws"]) {
			expect(allowedBrowserRequest(url)).toBe(true);
			expect(isBrowserURL(url)).toBe(false);
		}
		for (const url of [
			"ws://example.com",
			"file:///tmp/secret",
			"blob:file:///tmp/file",
			"wss://user:pass@example.com",
		])
			expect(allowedBrowserRequest(url)).toBe(false);
		expect(allowedBrowserRequest("blob:https://example.com/image-id")).toBe(true);
	});
});

describe("workspace browser lifecycle and agent ownership", () => {
	test("failed pages cannot be observed as successful content and agent navigation can recover", async () => {
		const { service, page, show } = fixture();
		show();
		const originalState = page.state;
		let failure: ReturnType<typeof describeBrowserLoadError> | null = null;
		page.state = () => ({
			...originalState(),
			error: failure?.message ?? null,
			loadError: failure,
		});
		const navigate = page.navigate;
		page.navigate = async (url) => {
			await navigate(url);
			failure = url.includes("missing") ? describeBrowserLoadError(-105, url) : null;
		};
		const failed = await executeBrowserAgentRequest(
			service,
			tab.workspaceId,
			{ operation: "navigate", browserId: tab.browserId, url: "https://www.missing.example/" },
			() => {}
		);
		expect(failed["status"]).toBe("failed");
		expect(service.state(tab).presented).toBe(false);
		await expect(service.observe(tab)).rejects.toThrow("DNS");
		await expect(service.screenshot(tab)).rejects.toThrow("DNS");
		const recovered = await executeBrowserAgentRequest(
			service,
			tab.workspaceId,
			{ operation: "navigate", browserId: tab.browserId, url: "https://example.com/" },
			() => {}
		);
		expect(recovered["status"]).toBe("loaded");
		expect(service.state(tab).presented).toBe(true);
	});
	test("linked tabs inherit workspace, viewport and paused agent access", async () => {
		const { service, show } = fixture();
		show();
		await service.command(tab, { kind: "viewport", viewport: "phone" });
		await service.command(tab, { kind: "agent-control", enabled: false });
		const opened = requestLinkedBrowserTab(service, tab, "https://example.com", true, () => {});
		expect(opened).toMatchObject({
			workspaceId: tab.workspaceId,
			openerId: tab.browserId,
			background: true,
			viewport: "phone",
		});
		expect(service.state(opened).agentControl).toBe(false);
		service.sync({ sequence: 2, tabs: [tab, opened], presentations: [{ ...opened, bounds }] });
		await expect(service.observe(opened)).rejects.toThrow("paused");
		expect(() =>
			requestLinkedBrowserTab(service, tab, "https://example.com", false, () => {})
		).toThrow("hidden");
		service.dispose();
	});
	for (const takeover of ["pause", "hide", "manual-navigation"] as const) {
		test(`${takeover} invalidates queued agent work even after control returns`, async () => {
			const { service, page, show } = fixture();
			show();
			let finish!: (value: string) => void;
			page.screenshot = () =>
				new Promise((resolve) => {
					finish = resolve;
				});
			const pending = service.screenshot(tab);
			const queued = service.command(
				tab,
				{ kind: "navigate", url: "https://old-agent.example" },
				true
			);
			const results = Promise.allSettled([pending, queued]);
			await new Promise((resolve) => setTimeout(resolve, 0));
			let manual: Promise<unknown> | undefined;
			if (takeover === "pause") {
				await service.command(tab, { kind: "agent-control", enabled: false });
				await service.command(tab, { kind: "agent-control", enabled: true });
			} else if (takeover === "hide") {
				service.sync({ sequence: 2, tabs: [tab], presentations: [] });
				show(3);
			} else manual = service.command(tab, { kind: "navigate", url: "https://user.example" });
			finish("old screenshot");
			for (const result of await results) expect(result.status).toBe("rejected");
			await manual;
			expect(service.state(tab).url).not.toBe("https://old-agent.example");
			await service.observe(tab);
		});
	}
	test("pause also invalidates element references from before the user took over", async () => {
		const { service, page, show } = fixture();
		show();
		const observation = await service.observe(tab);
		await service.command(tab, { kind: "agent-control", enabled: false });
		await service.command(tab, { kind: "agent-control", enabled: true });
		await expect(
			service.act(tab, {
				kind: "click",
				documentId: observation.documentId,
				sequence: observation.sequence,
				elementId: "button",
			})
		).rejects.toThrow("Observe again");
		expect(page.clicks).toBe(0);
	});
	test("agent-open cleanup preserves an adopted tab even when its workspace is hidden", () => {
		const { service } = fixture();
		const opened = { ...tab, browserId: "agent-open" };
		service.ensure(opened, false);
		service.sync({ sequence: 1, tabs: [tab, opened], presentations: [] });
		service.closeUnadopted(opened);
		expect(service.state(opened).presented).toBe(false);
		const orphan = { ...tab, browserId: "orphan" };
		service.ensure(orphan, false);
		service.closeUnadopted(orphan);
		expect(() => service.state(orphan)).toThrow("unavailable");
	});
	test("hide/show and re-adoption keep the same page and input", () => {
		const { service, page, pages, show } = fixture();
		show();
		service.sync({ sequence: 2, tabs: [tab], presentations: [] });
		expect(page.bounds).toBeNull();
		expect(page.closed).toBe(false);
		service.ensure(tab);
		show(3);
		expect(pages).toHaveLength(1);
		expect(page.value).toBe("draft");
		expect(page.bounds).toEqual(bounds);
	});
	test("older presentation cannot overtake a hide", () => {
		const { service, page, show } = fixture();
		show(2);
		service.sync({ sequence: 4, tabs: [tab], presentations: [] });
		show(3);
		expect(page.bounds).toBeNull();
	});
	test("removing metadata closes resources; workspace deletion closes hidden tabs", () => {
		const { service, page } = fixture();
		service.sync({ sequence: 1, tabs: [], presentations: [] });
		expect(page.closed).toBe(true);
		service.ensure(tab);
		service.closeWorkspace(tab.workspaceId);
		expect(service.list(tab.workspaceId)).toEqual([]);
	});
	test("foreign workspace cannot read, act on, or replace a browser", async () => {
		const { service, page, show } = fixture();
		show();
		const foreign = { ...tab, workspaceId: "workspace-b" };
		expect(() => service.ensure(foreign)).toThrow("another workspace");
		await expect(service.observe(foreign)).rejects.toThrow("unavailable");
		expect(service.list(foreign.workspaceId)).toEqual([]);
		service.close(foreign);
		expect(page.closed).toBe(false);
	});
	test("stale page observations are rejected before any action", async () => {
		const { service, page, show } = fixture();
		show();
		const observation = await service.observe(tab);
		page.value = "manually changed";
		await expect(
			service.act(tab, {
				kind: "click",
				documentId: observation.documentId,
				sequence: observation.sequence,
				elementId: "button",
			})
		).rejects.toThrow("Observe again");
		expect(page.clicks).toBe(0);
		const fresh = await service.observe(tab);
		await service.act(tab, {
			kind: "click",
			documentId: fresh.documentId,
			sequence: fresh.sequence,
			elementId: "button",
		});
		expect(page.clicks).toBe(1);
	});
	test("hidden and paused tabs reject agent reads, screenshots and mutations", async () => {
		const { service, show } = fixture();
		await expect(service.observe(tab)).rejects.toThrow("hidden");
		show();
		await service.command(tab, { kind: "agent-control", enabled: false });
		await expect(service.screenshot(tab)).rejects.toThrow("paused");
		await expect(
			service.command(tab, { kind: "navigate", url: "https://example.com" }, true)
		).rejects.toThrow("paused");
		await service.command(tab, { kind: "navigate", url: "https://example.com" });
		expect(service.state(tab).url).toBe("https://example.com");
	});
	test("hide bypasses pending I/O and discards a late agent result", async () => {
		const { service, page, show } = fixture();
		show();
		let finish!: (value: string) => void;
		page.screenshot = () =>
			new Promise((resolve) => {
				finish = resolve;
			});
		const capture = service.screenshot(tab);
		await new Promise((resolve) => setTimeout(resolve, 0));
		service.sync({ sequence: 2, tabs: [tab], presentations: [] });
		expect(page.bounds).toBeNull();
		finish("png");
		await expect(capture).rejects.toThrow("hidden");
	});
	test("queued operations cannot operate on a replacement tab with the same ID", async () => {
		const { service, page, show } = fixture();
		show();
		let finish!: (value: string) => void;
		page.screenshot = () =>
			new Promise((resolve) => {
				finish = resolve;
			});
		const capture = service.screenshot(tab);
		const queued = service.command(tab, { kind: "navigate", url: "https://example.com" }, true);
		await new Promise((resolve) => setTimeout(resolve, 0));
		service.close(tab);
		service.ensure(tab);
		const checks = Promise.allSettled([capture, queued]);
		finish("png");
		for (const result of await checks) {
			expect(result.status).toBe("rejected");
			if (result.status === "rejected") expect(result.reason.message).toContain("replaced");
		}
		expect(service.state(tab).url).toBe("");
	});
	test("agent open requests a real renderer tab; tools cannot change ownership", async () => {
		const { service } = fixture();
		let opened: BrowserTab | undefined;
		const result = await executeBrowserAgentRequest(
			service,
			tab.workspaceId,
			{ operation: "open", url: "https://example.com" },
			(value) => {
				opened = value;
			}
		);
		expect(opened?.workspaceId).toBe(tab.workspaceId);
		expect(result["status"]).toBe("opening");
		expect(
			browserAgentRequestSchema.safeParse({
				operation: "act",
				browserId: tab.browserId,
				action: { kind: "agent-control", enabled: true },
			}).success
		).toBe(false);
		service.dispose();
	});
});
