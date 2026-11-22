import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as monaco from "monaco-editor";
import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { NavRail } from "../../../src/renderer/components/NavRail";
import { ReviewPRSidebar } from "../../../src/renderer/components/ReviewPRSidebar";
import { PRReviewWorkspace } from "../../../src/renderer/components/review-mode/PRReviewWorkspace";
import {
	reviewUIScopeKey,
	reviewUIStoreFor,
} from "../../../src/renderer/components/review-mode/ReviewUIContext";
import { RailList } from "../../../src/renderer/components/review-mode/rail/RailList";
import { ReviewAgentJobCoordinator } from "../../../src/renderer/components/review-mode/useReviewAgentJob";
import type { RailItem } from "../../../src/renderer/lib/review-path-model";
import { getAllPanes, usePaneStore } from "../../../src/renderer/stores/pane-store";
import {
	prReviewSessionKey,
	usePRReviewSessionStore as sessions,
} from "../../../src/renderer/stores/pr-review-session-store";
import { useProjectStore } from "../../../src/renderer/stores/projects";
import { useReviewModeStore } from "../../../src/renderer/stores/review-mode-store";
import { useTabStore } from "../../../src/renderer/stores/tab-store";
import { trpc } from "../../../src/renderer/trpc/client";
import { ipcLink } from "../../../src/renderer/trpc/ipc-link";
import { prCtx } from "./data";
self.MonacoEnvironment = {
	getWorker(_id, label) {
		return new Worker(
			new URL(
				label === "typescript" || label === "javascript" ? "./ts-worker.js" : "./editor-worker.js",
				location.href
			),
			{ type: "module" }
		);
	},
};
const bridge = (window as any).validation;
const qc = new QueryClient({
	defaultOptions: { queries: { retry: false, gcTime: Number.POSITIVE_INFINITY } },
});
const client = trpc.createClient({ links: [ipcLink()] });
const active = { workspaceId: "registered", prCtx };
const ui = reviewUIStoreFor(reviewUIScopeKey(active));
const sessionKey = prReviewSessionKey("registered", "fixture/repo#1");
useTabStore.setState({
	activeWorkspaceId: "registered",
	activeWorkspaceCwd: "/not-live",
	sidebarSegment: "prs",
	workspaceMetadata: {
		registered: { type: "review", prProvider: "github", prIdentifier: "fixture/repo#1" },
	},
});
useReviewModeStore.getState().open("registered", prCtx);
useProjectStore.getState().setSidebarCollapsed(true);
useTabStore.getState().ensureReviewTab("registered", prCtx);
const first = getAllPanes(usePaneStore.getState().layouts["registered"]!)[0]!;
usePaneStore.getState().setFocusedPane(first.id);
useTabStore.getState().setDiffMode("split");
function Subject() {
	const layout = usePaneStore((s) => s.layouts["registered"]);
	const collapsed = useProjectStore((s) => s.sidebarCollapsed);
	useEffect(() => {
		const toggle = () =>
			useProjectStore.getState().setSidebarCollapsed(!useProjectStore.getState().sidebarCollapsed);
		window.addEventListener("app:toggle-sidebar", toggle);
		return () => window.removeEventListener("app:toggle-sidebar", toggle);
	}, []);
	return (
		<>
			<NavRail />
			<div style={{ marginLeft: 72, height: "100%", display: "flex", minWidth: 0 }}>
				{!collapsed && (
					<aside
						data-fixture-pr-sidebar
						style={{
							width: 288,
							flexShrink: 0,
							borderRight: "1px solid var(--border-subtle)",
							background: "var(--bg-surface)",
						}}
					>
						<ReviewPRSidebar />
					</aside>
				)}
				<div style={{ flex: 1, minWidth: 0, height: "100%" }}>
					<ReviewAgentJobCoordinator />
					<PRReviewWorkspace active={active} layout={layout} savedScrollback={{}} />
				</div>
			</div>
		</>
	);
}
createRoot(document.getElementById("root")!).render(
	<trpc.Provider client={client} queryClient={qc}>
		<QueryClientProvider client={qc}>
			<Subject />
		</QueryClientProvider>
	</trpc.Provider>
);
const results: any[] = [];
const metrics: any[] = [];
const check = (name: string, pass: boolean, detail?: unknown) =>
	results.push({ name, pass, detail });
const wait = (ms = 150) => new Promise((r) => setTimeout(r, ms));
const text = () => document.body.innerText;
const visible = (element: HTMLElement) =>
	element.getBoundingClientRect().width > 0 &&
	getComputedStyle(element).visibility !== "hidden" &&
	!element.closest("[inert]");
const button = (label: string) =>
	Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
		(b) => visible(b) && (b.textContent?.trim() === label || b.getAttribute("aria-label") === label)
	);
async function click(label: string) {
	const b = button(label);
	if (!b) throw Error(`Missing button ${label}`);
	b.click();
	await wait();
}
async function poll(fn: () => boolean, label: string) {
	for (let i = 0; i < 70; i++) {
		if (fn()) return;
		await wait(100);
	}
	throw Error(`Timeout ${label}: ${text().slice(0, 1200)}`);
}
async function refresh() {
	await qc.invalidateQueries();
	await wait(200);
}
async function capture(name: string) {
	await wait(200);
	await bridge.capture(name);
	metrics.push({
		name,
		width: innerWidth,
		height: innerHeight,
		scrollWidth: document.body.scrollWidth,
	});
}
const layout = () => usePaneStore.getState().layouts["registered"]!;
const reviewPane = () =>
	usePaneStore.getState().findPaneForTab("registered", "pr-review:registered")!;
const agentTab = () =>
	getAllPanes(layout())
		.flatMap((p) => p.tabs)
		.find((t) => t.kind === "review-agent");
const read = async () => {
	useTabStore.getState().setActiveTab("pr-review:registered");
	sessions.getState().selectFile(sessionKey, "src/alpha.ts");
	ui.getState().setOverviewOpen(false);
	await wait(300);
};
const diff = () => monaco.editor.getDiffEditors()[0]!;
async function verifyLongPathLabels() {
	const host = document.createElement("div");
	Object.assign(host.style, {
		position: "fixed",
		left: "80px",
		top: "60px",
		height: "500px",
		display: "flex",
		flexDirection: "column",
		zIndex: "1000",
		background: "var(--bg-surface)",
	});
	document.body.appendChild(host);
	const root = createRoot(host);
	const longTitle =
		"Provider callback contracts and request identity across reconciliation operations";
	const paths = Array.from(
		{ length: 180 },
		(_, index) =>
			`src/Domain/DebitAccountSportsRequestHandlerIntegrationTestsWithReconciliation${index}.cs`
	);
	const items: RailItem[] = [
		{ kind: "entry", id: "long-entry", title: longTitle },
		...paths.map((path, index) => ({
			kind: index % 2 ? ("test" as const) : ("step" as const),
			id: `wrap-${index}`,
			path,
			changed: true,
			number: index % 2 ? undefined : index + 1,
			entryId: "long-entry",
		})),
	];
	const render = (selectedPath: string | null) =>
		root.render(
			<RailList
				items={items}
				selectedPath={selectedPath}
				viewed={new Set()}
				counts={new Map()}
				onSelect={() => {}}
				virtualize
			/>
		);
	const noOverlap = () => {
		const rows = [...host.querySelectorAll<HTMLElement>("[data-rail-row]")]
			.map((node) => node.getBoundingClientRect())
			.sort((a, b) => a.top - b.top);
		return rows.every((row, index) => !index || row.top >= rows[index - 1]!.bottom - 1);
	};
	for (const width of [236, 288, 360]) {
		host.style.width = `${width}px`;
		render(null);
		await wait(400);
		const scroll = host.querySelector<HTMLElement>("[data-rail-scroll]")!;
		scroll.scrollTop = 0;
		await wait(300);
		const labels = [
			...host.querySelectorAll<HTMLElement>("[data-rail-filename],[data-rail-entry-title]"),
		];
		check(
			`long path labels wrap without clipping at ${width}px`,
			labels.length > 0 &&
				labels.every(
					(label) =>
						getComputedStyle(label).whiteSpace !== "nowrap" &&
						label.scrollWidth <= label.clientWidth + 1 &&
						label.scrollHeight <= label.clientHeight + 1
				) &&
				noOverlap()
		);
		check(
			`path group title fully visible at ${width}px`,
			host.querySelector("[data-rail-entry-title]")?.textContent === longTitle
		);
		if (width === 236) await bridge.capture("tabs-10-readable-path");
		render(paths.at(-1)!);
		await wait(450);
		const selected = host.querySelector<HTMLElement>('[aria-current="step"]');
		const bounds = scroll.getBoundingClientRect();
		const selection = selected?.getBoundingClientRect();
		check(
			`wrapped virtual list selects distant row at ${width}px`,
			!!selection &&
				selection.top >= bounds.top - 1 &&
				selection.bottom <= bounds.bottom + 1 &&
				noOverlap()
		);
		scroll.scrollTop = 0;
		scroll.dispatchEvent(new Event("scroll"));
		await wait(300);
		check(`manual scrolling stays put at ${width}px`, scroll.scrollTop === 0 && noOverlap());
	}
	root.unmount();
	host.remove();
}
async function run() {
	await poll(
		() => !!button("Start agent review") && !button("Start agent review")!.disabled,
		"setup"
	);
	check(
		"stable navigation rail is 72px",
		document.querySelector('nav[aria-label="Main navigation"]')?.getBoundingClientRect().width ===
			72
	);
	check("no fictional agent tab before acceptance", !agentTab());
	await capture("tabs-01-no-job");
	await click("Start agent review");
	await poll(() => !!agentTab(), "accepted agent tab");
	check(
		"preparing tab exists without stealing review focus",
		reviewPane().activeTabId === "pr-review:registered" && !!agentTab()
	);
	check("preparing job precedes reading path", !(await bridge.control("inspect")).snapshot.path);
	await read();
	await poll(() => !!diff()?.getModifiedEditor().getModel(), "real Monaco");
	check(
		"provider reading works during preparation",
		diff().getModifiedEditor().getValue().includes("head alpha")
	);
	await capture("tabs-02-preparing-reading");
	const job = (await bridge.control("inspect")).jobs[0];
	useTabStore.getState().revealReviewAgentTab("registered", { jobId: job.id, beside: true });
	await wait(600);
	check(
		"split starts at 60 percent",
		layout().type === "split" && Math.abs((layout() as any).ratio - 0.6) < 0.01
	);
	check(
		"real Monaco unified in narrow review pane",
		!!document.querySelector(".monaco-diff-editor:not(.side-by-side)")
	);
	check("wide diff preference remains split", useTabStore.getState().diffMode === "split");
	await capture("tabs-03-split");
	ui.getState().setPanel("ask");
	await wait(300);
	const input = document.querySelector<HTMLTextAreaElement>(
		'textarea[aria-label="Ask a follow-up"]'
	)!;
	check(
		"Ask fits review pane",
		input.getBoundingClientRect().width > 100 &&
			input.getBoundingClientRect().right <=
				document.querySelector("[data-review-workspace]")!.getBoundingClientRect().right
	);
	input.focus();
	Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
		input,
		"Preserve draft across pane moves"
	);
	input.dispatchEvent(new Event("input", { bubbles: true }));
	await wait();
	await capture("tabs-04-ask");
	await click("Toggle PR list");
	await wait(400);
	await poll(
		() => !!document.querySelector('input[aria-label="Filter pull requests"]'),
		"real PR sidebar"
	);
	check(
		"sidebar is 288px beside split panes",
		document.querySelector("[data-fixture-pr-sidebar]")?.getBoundingClientRect().width === 288 &&
			getAllPanes(layout()).length === 2
	);
	const sidebarInput = document.querySelector<HTMLInputElement>(
		'input[aria-label="Filter pull requests"]'
	)!;
	const setSearch = async (value: string) => {
		Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
			sidebarInput,
			value
		);
		sidebarInput.dispatchEvent(new Event("input", { bubbles: true }));
		await wait();
	};
	document.querySelector<HTMLButtonElement>('[aria-controls="review-list-authored"]')!.click();
	await wait();
	check(
		"authored section uses actual author-role data",
		document
			.querySelector("#review-list-authored")
			?.textContent?.includes("Authored fixture change") === true &&
			!document
				.querySelector("#review-list-needsReview")
				?.textContent?.includes("Authored fixture change")
	);
	await setSearch("Authored fixture change");
	check(
		"search filters review requests and authored rows",
		!document.querySelector("#review-list-needsReview")?.textContent?.includes("Disposable PR") &&
			document
				.querySelector("#review-list-authored")
				?.textContent?.includes("Authored fixture change") === true
	);
	await setSearch("");
	const narrowAsk = document.querySelector<HTMLTextAreaElement>(
		'textarea[aria-label="Ask a follow-up"]'
	)!;
	check(
		"Ask remains usable with sidebar and split",
		narrowAsk.getBoundingClientRect().width > 180 &&
			narrowAsk.getBoundingClientRect().right <=
				document.querySelector("[data-review-workspace]")!.getBoundingClientRect().right
	);
	check(
		"sidebar preserves selected diff and unsent draft",
		sessions.getState().sessions.get(sessionKey)?.activeFilePath === "src/alpha.ts" &&
			narrowAsk.value === "Preserve draft across pane moves"
	);
	await capture("tabs-04b-sidebar-split-ask");
	await click("Toggle PR list");
	await wait(300);
	check(
		"closing sidebar preserves selection and Ask draft",
		!document.querySelector("[data-fixture-pr-sidebar]") &&
			sessions.getState().sessions.get(sessionKey)?.activeFilePath === "src/alpha.ts" &&
			document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Ask a follow-up"]')
				?.value === "Preserve draft across pane moves"
	);
	ui.getState().setPanel(null);
	await bridge.control("jobState", "failed");
	await refresh();
	check(
		"failed job exposes retry",
		!!button("Retry") && text().includes("Controlled fetch failure")
	);
	await capture("tabs-05-failed");
	await click("Retry");
	await poll(() => text().includes("Preparing"), "retry");
	check("retry keeps stable job tab", (await bridge.control("inspect")).jobs.length === 1);
	await click("Cancel");
	await refresh();
	check("cancel acknowledged", (await bridge.control("inspect")).jobs[0].state === "cancelled");
	await capture("tabs-06-stopped");
	await click("Retry");
	await bridge.control("mapped");
	await refresh();
	check("completed job inspectable without relaunch", text().includes("Done") && !button("Cancel"));
	await capture("tabs-07-ended");
	await click("Review findings");
	await poll(
		() => sessions.getState().sessions.get(sessionKey)?.activeThreadId === "ai-finding",
		"agent finding navigation"
	);
	check(
		"agent results opens actual inline finding, not provider Threads",
		ui.getState().panel === null &&
			sessions.getState().sessions.get(sessionKey)?.activeFilePath === "src/alpha.ts" &&
			!!document.querySelector('[data-thread-id="ai-finding"]')
	);

	await click("Open reading path");
	await click("Path summary");
	await poll(() => text().includes("How this path was made"), "summary after path poll");
	check("summary return works", text().includes("How this path was made"));
	await capture("tabs-08-summary");
	const agentPane = getAllPanes(layout()).find((p) =>
		p.tabs.some((t) => t.kind === "review-agent")
	)!;
	usePaneStore.getState().closePane("registered", agentPane.id);
	await wait(500);
	ui.getState().setPanel("ask");
	await wait();
	check(
		"draft survives split parent remount",
		document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Ask a follow-up"]')?.value ===
			"Preserve draft across pane moves"
	);
	ui.getState().setPanel(null);
	await read();
	check("wide restores split diff", !!document.querySelector(".monaco-diff-editor.side-by-side"));
	await bridge.control("resize", { width: 700, height: 800 });
	await wait(500);
	check(
		"narrow collapses navigator with visible affordance",
		!!button("Files & path") &&
			!document.querySelector('nav[aria-label="Changed files"],nav[aria-label="Reading path"]')
	);
	await capture("tabs-09-narrow");
	check("no provider or PTY writes", (await bridge.control("inspect")).forbidden.length === 0);
	check(
		"no body horizontal overflow",
		metrics.every((m) => m.scrollWidth <= m.width),
		metrics
	);
	await verifyLongPathLabels();
	await bridge.complete({ results, metrics });
}
void run().catch(async (e) => {
	await bridge.capture("tabs-failure");
	await bridge.complete({ results, metrics, fatal: String(e), body: text() });
});
