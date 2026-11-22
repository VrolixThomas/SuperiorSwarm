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
import { prCtx } from "../review-workspace-native/data";
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
	await poll(() => !!button("Map this PR") && !button("Map this PR")!.disabled, "ready");
	await click("Map this PR");
	await bridge.control("mapped");
	await wait(1600);
	await select("src/alpha.ts");
	await poll(() => editors().length === 2 && modified().getValue().includes("head alpha"), "alpha");
	original().focus();
	original().setSelection(new monaco.Selection(2, 1, 3, 5));
	await wait();
	await key("/");
	check(
		"LEFT keyboard Ask keeps selected old-code range",
		store.getState().askAnchor?.side === "LEFT" &&
			store.getState().askAnchor?.startLine === 2 &&
			store.getState().askAnchor?.endLine === 3,
		store.getState().askAnchor
	);
	store.getState().setPanel(null);
	await wait();
	modified().focus();
	modified().setSelection(new monaco.Selection(4, 1, 4, 1));
	await wait();
	await key("/");
	check(
		"empty opposite selection clears old LEFT anchor",
		store.getState().askAnchor?.side === "RIGHT" && store.getState().askAnchor?.startLine === 1,
		store.getState().askAnchor
	);
	store.getState().setPanel(null);
	await wait();
	original().focus();
	original().setSelection(new monaco.Selection(2, 1, 3, 5));
	await wait();
	await select("src/beta.ts");
	await poll(() => modified().getValue().includes("head beta"), "beta");
	modified().focus();
	await key("/");
	check(
		"file model switch clears old selection",
		store.getState().askAnchor?.path === "src/beta.ts" &&
			store.getState().askAnchor?.startLine === 1,
		store.getState().askAnchor
	);
	store.getState().setPanel(null);
	await wait();
	await select("src/alpha.ts");
	await poll(() => modified().getValue().includes("head alpha"), "alpha return");
	original().focus();
	original().setSelection(new monaco.Selection(2, 1, 3, 5));
	await wait();
	await key("c");
	check(
		"LEFT keyboard comment stays in original editor",
		document.querySelectorAll('.editor.original textarea[placeholder="Write a comment..."]')
			.length === 1 &&
			document.querySelectorAll('.editor.modified textarea[placeholder="Write a comment..."]')
				.length === 0
	);
	await type('.editor.original textarea[placeholder="Write a comment..."]', "Old-code question");
	await key(
		"Enter",
		[],
		document.querySelector<HTMLElement>(
			'.editor.original textarea[placeholder="Write a comment..."]'
		)!
	);
	const save = (await bridge.control("inspect")).calls.find(
		(c: any) => c.path === "aiReview.addUserComment"
	);
	const head = qc
		.getQueriesData({})
		.map(([, v]: any) => v?.headCommitOid)
		.find(Boolean);
	check(
		"LEFT comment carries exact snapshot revision and end line",
		save?.input?.side === "LEFT" && save.input.lineNumber === 3 && save.input.commitSha === head,
		{ input: save?.input, head }
	);
	for (let i = 0; i < 4; i++) {
		await select("context.ts");
		await poll(
			() => editors().some((editor) => editor.getValue().includes("saved context")),
			`context ${i}`
		);
		await select("src/alpha.ts");
		await refresh();
		await poll(
			() => editors().length === 2 && modified().getValue().includes("head alpha"),
			`diff return ${i}`
		);
		check(
			`context return and refetch ${i} retains pinned diff`,
			original().getValue().includes("base alpha") && modified().getValue().includes("head alpha")
		);
	}
	for (let i = 0; i < 12; i++) {
		sessions.getState().selectFile(sessionKey, i % 2 ? "src/alpha.ts" : "src/beta.ts");
		await wait(10);
	}
	await poll(() => modified().getValue().includes("head alpha"), "rapid switching settled");
	check(
		"rapid model switching settles on selected revision",
		selected() === "src/alpha.ts" && modified().getValue().includes("head alpha")
	);
	await capture("f4-repeated-context");
	await bridge.control("head", "f".repeat(40));
	await refresh();
	await poll(
		() => text().includes("Refresh") && editors().every((e) => e.getValue() === ""),
		"unknown revision refused"
	);
	check(
		"unknown head never retains old model content",
		editors().every((e) => e.getValue() === "")
	);
	check("head switch clears Ask anchor", store.getState().askAnchor === null);
	const evidence = await bridge.control("inspect");
	check(
		"no external review or terminal writes",
		evidence.forbidden.length === 0 &&
			!evidence.calls.some((c: any) =>
				/submitReview|addReviewComment|replyToPRComment|resolveThread/.test(c.path)
			)
	);
	await bridge.complete({ results, metrics, queryErrors });
}
void run().catch(async (e) => {
	await bridge.capture("failure");
	await bridge.complete({ results, metrics, queryErrors, fatal: String(e), body: text() });
});
