import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as monaco from "monaco-editor";
import { createRoot } from "react-dom/client";
import { ReviewWorkspace } from "../../../src/renderer/components/review-mode/ReviewWorkspace";
import {
	prReviewSessionKey,
	usePRReviewSessionStore as sessions,
} from "../../../src/renderer/stores/pr-review-session-store";
import { useReviewModeStore as store } from "../../../src/renderer/stores/review-mode-store";
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
const queryErrors: any[] = [];
const qc = new QueryClient({
	queryCache: new QueryCache({
		onError: (error, query) => queryErrors.push({ error: String(error), key: query.queryKey }),
	}),
	defaultOptions: { queries: { retry: false, gcTime: Number.POSITIVE_INFINITY } },
});
const client = trpc.createClient({ links: [ipcLink()] });
const sessionKey = prReviewSessionKey("registered", "fixture/repo#1");
const wait = (ms = 150) => new Promise((r) => setTimeout(r, ms));
const results: { name: string; pass: boolean; detail?: unknown }[] = [];
const metrics: any[] = [];
const check = (name: string, pass: boolean, detail?: unknown) =>
	results.push({ name, pass, detail: structuredClone(detail) });
const text = () => document.body.innerText;
const buttons = () => Array.from(document.querySelectorAll<HTMLButtonElement>("button"));
const button = (s: string) =>
	buttons().find((b) => b.textContent?.trim() === s || b.getAttribute("aria-label") === s);
const click = async (s: string) => {
	const b = button(s);
	if (!b) throw Error(`Missing button ${s}`);
	b.click();
	await wait();
};
const shell = () => document.querySelector<HTMLElement>("[data-review-workspace]")!;
const selected = () => sessions.getState().sessions.get(sessionKey)?.activeFilePath;
const select = async (path: string) => {
	sessions.getState().selectFile(sessionKey, path);
	store.getState().setOverviewOpen(false);
	store.getState().setView("changes");
	await wait(350);
};
const editors = () => monaco.editor.getEditors().filter((e) => e.getModel());
const modified = () =>
	editors().find((e) => e.getDomNode()?.closest(".editor.modified")) ?? editors().at(-1)!;
const original = () =>
	editors().find((e) => e.getDomNode()?.closest(".editor.original")) ?? editors()[0]!;
async function key(key: string, modifiers: string[] = [], target?: HTMLElement) {
	if (target) target.focus();
	await bridge.input({ type: "keyDown", keyCode: key.replace("Arrow", ""), modifiers });
	await bridge.input({ type: "keyUp", keyCode: key.replace("Arrow", ""), modifiers });
	await wait();
}
async function poll(fn: () => boolean, label: string) {
	for (let i = 0; i < 80; i++) {
		if (fn()) return;
		await wait(100);
	}
	throw Error(`Timeout ${label}: ${text().slice(0, 1000)}`);
}
async function type(selector: string, value: string) {
	const el = document.querySelector<HTMLTextAreaElement>(selector);
	if (!el) throw Error(`Missing ${selector}`);
	el.focus();
	Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(el, value);
	el.dispatchEvent(new Event("input", { bubbles: true }));
	await wait();
}
async function capture(category: string) {
	for (const theme of ["dark", "light"]) {
		document.documentElement.dataset["theme"] = theme;
		monaco.editor.setTheme(`superiorswarm-${theme}`);
		await wait();
		await bridge.capture(`${category}-${theme}`);
		metrics.push({
			category,
			theme,
			width: innerWidth,
			height: innerHeight,
			bodyScroll: document.body.scrollWidth,
			main: document.querySelector("main")?.getBoundingClientRect().toJSON(),
			rail: document.querySelector("nav")?.getBoundingClientRect().toJSON(),
		});
	}
	document.documentElement.dataset["theme"] = "dark";
	monaco.editor.setTheme("superiorswarm-dark");
}
async function refresh() {
	await qc.invalidateQueries();
	await wait(250);
}
function Subject() {
	const active = store((s) => s.active);
	return active ? <ReviewWorkspace active={active} /> : <div>Closed review</div>;
}
store.getState().open("registered", prCtx);
useTabStore.getState().setDiffMode("split");
createRoot(document.getElementById("root")!).render(
	<trpc.Provider client={client} queryClient={qc}>
		<QueryClientProvider client={qc}>
			<Subject />
		</QueryClientProvider>
	</trpc.Provider>
);
async function run() {
	await poll(
		() => !!button("Start agent review") && !button("Start agent review")!.disabled,
		"initial live workspace"
	);
	check("live adapter loads overview", text().includes("Disposable PR") && text().includes("106"));
	await capture("01-start-no-path");
	await click("Start agent review");
	await wait(350);
	await capture("02-mapping-live");
	await select("src/alpha.ts");
	await poll(() => editors().length === 2, "actual Monaco models");
	const initialModels = monaco.editor.getModels().length;
	await bridge.control("mapped");
	await wait(1300);
	check("mapping update preserves selected file", selected() === "src/alpha.ts");
	check(
		"immutable head content in real Monaco",
		modified().getValue().includes("head alpha"),
		modified().getValue()
	);
	await capture("03-reading-step");
	for (const k of ["t", "f", "v", "n", "p", "/"]) {
		store.getState().setPanel(null);
		await wait();
		modified().focus();
		await key(k);
		check(
			`native diff key ${k}`,
			k === "t"
				? store.getState().panel === "threads"
				: k === "/"
					? store.getState().panel === "ask"
					: k === "f"
						? store.getState().railMode === "files"
						: k === "v"
							? (await bridge.control("inspect")).calls.some(
									(c: any) => c.path === "github.markFileViewed"
								)
							: !!sessions.getState().sessions.get(sessionKey)?.activeThreadId,
			{ panel: store.getState().panel, railMode: store.getState().railMode }
		);
	}
	store.getState().setPanel(null);
	await wait();
	const beforeJ = selected();
	modified().focus();
	await key("j");
	check("native diff j changes selected item", selected() !== beforeJ, {
		before: beforeJ,
		after: selected(),
	});
	modified().focus();
	await key("k");
	check("native diff k returns to prior file", selected() === "src/alpha.ts");
	await select("src/alpha.ts");
	modified().focus();
	await key(".", ["meta"]);
	check("native diff Cmd period collapses rail", store.getState().navigatorCollapsed);
	store.setState({ navigatorCollapsed: false });
	await select("src/alpha.ts");
	modified().setSelection(new monaco.Selection(2, 1, 3, 5));
	await wait();
	check("right selection exposes actions", !!button("Comment · c") && !!button("Ask agent"));
	button("Comment · c")!.parentElement!.querySelector<HTMLButtonElement>("button")!.click();
	await wait();
	check(
		"right selection Ask anchor",
		store.getState().askAnchor?.side === "RIGHT" &&
			store.getState().askAnchor?.startLine === 2 &&
			store.getState().askAnchor?.endLine === 3,
		store.getState().askAnchor
	);
	await type('textarea[aria-label="Ask a follow-up"]', "Unsaved follow-up survives refetch");
	await refresh();
	check(
		"typed Ask draft survives refetch",
		document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Ask a follow-up"]')?.value ===
			"Unsaved follow-up survives refetch"
	);
	await capture("04-ask-and-comment");
	await click("Send question");
	await poll(() => text().includes("Agent is answering"), "pending Ask");
	check("pending Ask disables duplicate send", button("Send question")!.disabled);
	await click("Cancel question");
	check("Ask cancellation shown", text().includes("cancelled"));
	await type('textarea[aria-label="Ask a follow-up"]', "Why this validation?");
	await click("Send question");
	await bridge.control("failed");
	await wait(1300);
	check("failed Ask exposes retry", !!button("Retry"));
	await click("Retry");
	await bridge.control("answer");
	await wait(1300);
	check("retry answer appears", text().includes("The check rejects invalid input."));
	document.querySelector<HTMLButtonElement>("[data-reference]")?.click();
	await wait(350);
	check(
		"answer reference opens target model",
		selected() === "src/beta.ts" &&
			modified().getValue().includes("head beta") &&
			modified().getPosition()?.lineNumber === 3,
		{ selected: selected(), position: modified().getPosition() }
	);
	document.querySelector<HTMLButtonElement>("[data-add-comment]")?.click();
	await wait(350);
	check("Add as comment opens original anchor file", selected() === "src/alpha.ts");
	check(
		"Add as comment prefills actual inline composer",
		Array.from(document.querySelectorAll("textarea")).some(
			(t) => t.value === "The check rejects invalid input."
		)
	);
	await key(
		"Enter",
		[],
		document.querySelector<HTMLElement>('textarea[placeholder="Write a comment..."]')!
	);
	check(
		"Add as comment saves correct side/end line",
		(await bridge.control("inspect")).calls.some(
			(c: any) =>
				c.path === "aiReview.addUserComment" &&
				c.input.side === "RIGHT" &&
				c.input.lineNumber === 3 &&
				c.input.body === "The check rejects invalid input."
		)
	);
	store.getState().setPanel(null);
	await wait();
	modified().setSelection(new monaco.Selection(1, 1, 1, 1));
	original().setSelection(new monaco.Selection(2, 1, 3, 5));
	original().focus();
	await wait();
	check("left selection exposes Ask and Comment actions", !!button("Comment · c"));
	await key("/");
	check(
		"left selected-line Ask retains side and range",
		store.getState().askAnchor?.side === "LEFT" &&
			store.getState().askAnchor?.startLine === 2 &&
			store.getState().askAnchor?.endLine === 3,
		store.getState().askAnchor
	);
	store.getState().setPanel(null);
	await wait();
	original().focus();
	await key("c");
	await wait();
	check(
		"left c places composer in original editor",
		!!document.querySelector('.editor.original textarea[placeholder="Write a comment..."]'),
		{
			left: document.querySelectorAll('.editor.original textarea[placeholder="Write a comment..."]')
				.length,
			right: document.querySelectorAll(
				'.editor.modified textarea[placeholder="Write a comment..."]'
			).length,
		}
	);
	await key("Escape", [], shell());
	await capture("05-agent-findings");
	if (button("Edit")) {
		await click("Edit");
		await type('textarea[aria-label="Edit finding"]', "Edited native finding");
		await click("Save");
		check(
			"edit persists local body",
			(await bridge.control("inspect")).calls.some(
				(c: any) =>
					c.path === "aiReview.updateDraftComment" && c.input.userEdit === "Edited native finding"
			)
		);
	}
	await bridge.control("resetFinding");
	await refresh();
	if (button("Dismiss")) {
		await click("Dismiss");
		check(
			"dismiss stays local",
			(await bridge.control("inspect")).calls.some(
				(c: any) => c.path === "aiReview.updateDraftComment" && c.input.status === "rejected"
			)
		);
	}
	await bridge.control("resetFinding");
	await refresh();
	if (button("Accept")) {
		await click("Accept");
		check(
			"Accept updates local draft status",
			(await bridge.control("inspect")).calls.some(
				(c: any) => c.path === "aiReview.updateDraftComment" && c.input.status === "user-pending"
			)
		);
	}
	await click("Submit review");
	await type('textarea[placeholder="Summary comment (optional)"]', "Native test summary");
	await click("Approve");
	buttons()
		.filter((b) => b.textContent?.trim() === "Submit review")
		.at(-1)!
		.click();
	await wait();
	check(
		"explicit submit payload reaches inert backend",
		(await bridge.control("inspect")).calls.some(
			(c: any) =>
				c.path === "aiReview.submitReview" &&
				c.input.draftId === "draft" &&
				c.input.verdict === "APPROVE" &&
				c.input.body === "Native test summary"
		)
	);
	buttons()
		.find((b) => b.textContent?.startsWith("All PRs"))!
		.click();
	await wait();
	await capture("06-all-prs-next-pr");
	await key("Escape", [], shell());
	store.getState().setPanel(null);
	store.getState().setRailMode("files");
	await wait();
	await capture("07-files-view");
	check(
		"large manifest virtualizes rail",
		document.querySelectorAll("[data-rail-kind]").length < 106,
		{ rendered: document.querySelectorAll("[data-rail-kind]").length }
	);
	await select("many/file-101.ts");
	check(
		"last >100 file renders exact content",
		modified().getValue().includes("head 101"),
		modified().getValue()
	);
	check("model count bounded after navigation", monaco.editor.getModels().length <= initialModels, {
		initialModels,
		now: monaco.editor.getModels().length,
	});
	store.getState().setRailMode("path");
	await wait();
	await select("unchanged.test.ts");
	const beforeViewed = (await bridge.control("inspect")).calls.filter(
		(c: any) => c.path === "github.markFileViewed"
	).length;
	await key("v", [], shell());
	check(
		"unchanged test never marked viewed",
		(await bridge.control("inspect")).calls.filter((c: any) => c.path === "github.markFileViewed")
			.length === beforeViewed
	);
	await select("context.ts");
	await capture("08-context-files");
	check(
		"context snapshot rendered",
		editors().some((e) => e.getValue().includes("saved context"))
	);
	await key("v", [], shell());
	check(
		"saved context never marked viewed",
		(await bridge.control("inspect")).calls.filter((c: any) => c.path === "github.markFileViewed")
			.length === beforeViewed
	);
	editors()[0]?.focus();
	await key("t");
	check("native context t opens threads", store.getState().panel === "threads");
	store.getState().setPanel(null);
	await select("src/alpha.ts");
	check(
		"returning from context retains available diff",
		editors().length === 2 && modified().getValue().includes("head alpha"),
		queryErrors
	);
	await key("t", [], shell());
	await capture("09-comments-from-others");
	await click("mine");
	check(
		"Mine uses stable identity",
		!!document.querySelector('aside [data-thread-id="left"]') &&
			!document.querySelector('aside [data-thread-id="right"]')
	);
	await bridge.control("account", "99");
	await refresh();
	check(
		"Mine updates after account switch",
		!document.querySelector('aside [data-thread-id="left"]') &&
			!!document.querySelector('aside [data-thread-id="right"]')
	);
	await click("open");
	check("unknown resolution visibly identified", text().toLowerCase().includes("unknown"));
	check(
		"outdated thread preserved",
		text().includes("Earlier revision thread") || text().includes("was line 9")
	);
	const width = document.querySelector(".monaco-diff-editor")?.getBoundingClientRect().width;
	await key("Escape", [], shell());
	const closedWidth = document.querySelector(".monaco-diff-editor")?.getBoundingClientRect().width;
	check("overlay preserves diff width", width === closedWidth, { width, closedWidth });
	const resize = document.querySelector<HTMLElement>('[aria-label="Resize review rail"]')!;
	await key("ArrowRight", [], resize);
	check(
		"rail keyboard resize",
		document.querySelector("nav")?.getBoundingClientRect().width === 308,
		document.querySelector("nav")?.getBoundingClientRect().toJSON()
	);
	const grip = resize.getBoundingClientRect();
	await bridge.input({
		type: "mouseDown",
		x: Math.round(grip.x + 2),
		y: Math.round(grip.y + 20),
		button: "left",
		clickCount: 1,
	});
	await bridge.input({
		type: "mouseMove",
		x: 800,
		y: Math.round(grip.y + 20),
		modifiers: ["leftButtonDown"],
	});
	await bridge.input({
		type: "mouseUp",
		x: 800,
		y: Math.round(grip.y + 20),
		button: "left",
		clickCount: 1,
	});
	await wait();
	check(
		"native pointer rail resize clamps to 360",
		document.querySelector("nav")?.getBoundingClientRect().width === 360
	);
	await key(".", ["meta"], shell());
	check("shell Cmd period collapses rail", !document.querySelector("nav"));
	await key(".", ["meta"], shell());
	for (const path of ["binary.dat", "empty.txt"]) {
		await select(path);
		check(
			`${path} handled without stale alpha text`,
			path === "binary.dat"
				? text().toLowerCase().includes("binary") && editors().every((e) => e.getValue() === "")
				: editors().every((e) => e.getValue() === ""),
			{ text: text().slice(-500), editors: editors().length }
		);
	}
	await select("src/alpha.ts");
	await key("/", [], shell());
	await type(
		'textarea[aria-label="Ask a follow-up"]',
		"Do not lose this question on launch failure"
	);
	await bridge.control("askError", true);
	await click("Send question");
	await wait(1700);
	check(
		"transport error remains exposed after poll",
		text().includes("Controlled provider unavailable"),
		text().slice(-1200)
	);
	check(
		"transport error retains question or retry",
		text().includes("Do not lose this question on launch failure") ||
			Array.from(document.querySelectorAll("textarea")).some((t) =>
				t.value.includes("Do not lose this question")
			)
	);
	await bridge.control("head", "f".repeat(40));
	await refresh();
	check("head refresh clears selected Ask anchor", store.getState().askAnchor === null);
	store.getState().setPanel(null);
	await poll(
		() => !!document.querySelector("output")?.textContent?.includes("unavailable"),
		"unknown revision failure"
	);
	check(
		"unknown commit renders unavailable instead of stale content",
		editors().every((e) => e.getValue() === "") &&
			!!document.querySelector("output")?.textContent?.includes("unavailable"),
		{
			notice: document.querySelector("output")?.textContent,
			modelLengths: editors().map((e) => e.getValue().length),
		}
	);
	check("nine categories captured in both themes", metrics.length === 18);
	check(
		"1512x945 no body horizontal overflow",
		metrics.every((m) => m.width === 1512 && m.height === 945 && m.bodyScroll <= 1512),
		metrics
	);
	store.getState().setPanel(null);
	await key("ArrowDown", ["meta"], shell());
	check(
		"shell Cmd Down opens next PR through workspace mutation",
		store.getState().active?.prCtx.number === 2,
		(await bridge.control("inspect")).calls.filter(
			(c: any) => c.path === "workspaces.getOrCreateReview"
		)
	);
	await key("ArrowUp", ["meta"], shell());
	check("shell Cmd Up returns to previous PR", store.getState().active?.prCtx.number === 1);
	const evidence = await bridge.control("inspect");
	check(
		"no unrequested provider posting or terminal writes",
		evidence.forbidden.length === 0 &&
			!evidence.calls.some((c: any) =>
				/addReviewComment|replyToPRComment|resolveThread/.test(c.path)
			),
		evidence.forbidden
	);
	await bridge.complete({ results, metrics, queryErrors });
}
void run().catch(async (e) => {
	await bridge.capture("failure");
	await bridge.complete({ results, metrics, queryErrors, fatal: String(e), body: text() });
});
