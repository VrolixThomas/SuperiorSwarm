import { expect, test } from "bun:test";
import { act } from "react";
import { inIsolatedFileBrowserTest } from "./helpers/isolated-file-browser-test";
if (
	inIsolatedFileBrowserTest(import.meta.path, "Review workspace drafts and summary in isolation")
) {
	const { renderBrowserTest } = await import("./helpers/file-browser-renderer");
	const { ReviewUIProvider, useReviewDraft, useReviewUIStore, reviewUIStoreFor } = await import(
		"../src/renderer/components/review-mode/ReviewUIContext"
	);
	const { usePRReviewSessionStore } = await import(
		"../src/renderer/stores/pr-review-session-store"
	);
	const { AskTab } = await import("../src/renderer/components/review-mode/panel/AskTab");
	const { PathSummaryCard } = await import(
		"../src/renderer/components/review-mode/views/PathSummaryCard"
	);
	const { PR129_PATH } = await import("../src/renderer/lib/review-path-fixtures");
	function Probe() {
		const [draft] = useReviewDraft("draft", "");
		const panel = useReviewUIStore((s) => s.panel);
		return (
			<div>
				<output>{panel}</output>
				<input aria-label="Draft" value={draft} readOnly />
			</div>
		);
	}
	const scoped = (key: string, child = <Probe />) => (
		<ReviewUIProvider scopeKey={key}>{child}</ReviewUIProvider>
	);
	test("separate PR scopes retain panels and unsent text after unmount and pane-parent moves", async () => {
		const h = await renderBrowserTest(scoped("scope:a"));
		try {
			await act(async () => {
				reviewUIStoreFor("scope:a").getState().setPanel("ask");
				usePRReviewSessionStore.getState().setDraft("scope:a", "draft", "unfinished A");
			});
			await h.rerender(scoped("scope:b"));
			expect(h.container.querySelector("input")!.value).toBe("");
			expect(h.container.querySelector("output")!.textContent).toBe("");
			await h.rerender(<div data-pane="new">{scoped("scope:a")}</div>);
			expect(h.container.querySelector("input")!.value).toBe("unfinished A");
			expect(h.container.querySelector("output")!.textContent).toBe("ask");
		} finally {
			await h.cleanup();
		}
	});
	test("Ask draft survives closing panel without focus from hidden tabs", async () => {
		usePRReviewSessionStore.getState().setDraft("scope:ask", "ask:text", "Keep my question");
		const h = await renderBrowserTest(
			<ReviewUIProvider scopeKey="scope:ask" active={false}>
				<AskTab messages={[]} available onSend={() => {}} onReference={() => {}} />
			</ReviewUIProvider>
		);
		try {
			expect(h.container.querySelector("textarea")!.value).toBe("Keep my question");
			expect(document.activeElement).not.toBe(h.container.querySelector("textarea"));
			await h.rerender(<div />);
			await h.rerender(
				scoped(
					"scope:ask",
					<AskTab messages={[]} available onSend={() => {}} onReference={() => {}} />
				)
			);
			expect(h.container.querySelector("textarea")!.value).toBe("Keep my question");
		} finally {
			await h.cleanup();
		}
	});
	test("summary shows unknown legacy timing and makes findings actionable", async () => {
		let opened = 0;
		const h = await renderBrowserTest(
			<PathSummaryCard
				path={PR129_PATH}
				headSha={PR129_PATH.headSha}
				findingsCount={2}
				onRead={() => {}}
				onBrowse={() => {}}
				onFindings={() => opened++}
			/>
		);
		try {
			expect(h.container.textContent).toContain("Latest revision");
			expect(h.container.textContent).toContain("—");
			expect(h.container.textContent).not.toContain("Automatically");
			const findings = Array.from(h.container.querySelectorAll("button")).find((x) =>
				x.textContent?.includes("2 findings")
			)!;
			await act(async () => findings.click());
			expect(opened).toBe(1);
		} finally {
			await h.cleanup();
		}
	});
}
