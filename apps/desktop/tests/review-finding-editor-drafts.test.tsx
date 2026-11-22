import { expect, test } from "bun:test";
import { act } from "react";
import type { AIDraftThread } from "../src/shared/github-types";
import { inIsolatedFileBrowserTest } from "./helpers/isolated-file-browser-test";

if (inIsolatedFileBrowserTest(import.meta.path, "finding editor draft isolation")) {
	const { renderBrowserTest } = await import("./helpers/file-browser-renderer");
	const { FindingCard } = await import("../src/renderer/components/review-mode/thread/FindingCard");
	const { ReviewUIProvider } = await import(
		"../src/renderer/components/review-mode/ReviewUIContext"
	);
	const { usePRReviewSessionStore } = await import(
		"../src/renderer/stores/pr-review-session-store"
	);
	const finding = (id: string, body: string): AIDraftThread => ({
		id: `thread-${id}`,
		draftCommentId: id,
		isAIDraft: true,
		path: `${id}.ts`,
		line: 1,
		diffSide: "RIGHT",
		body,
		status: "pending",
		userEdit: null,
		createdAt: "2026-11-22T00:00:00Z",
	});
	const a = finding("finding-a", "Original finding A");
	const b = finding("finding-b", "Original finding B");
	function card(container: HTMLElement, thread: AIDraftThread) {
		const node = container.querySelector<HTMLElement>(`[data-thread-id="${thread.id}"]`);
		if (!node) throw new Error(`Missing finding ${thread.id}`);
		return node;
	}
	async function click(container: HTMLElement, thread: AIDraftThread, label: string) {
		const button = [...card(container, thread).querySelectorAll("button")].find(
			(button) => button.textContent === label
		);
		if (!button) throw new Error(`Missing ${label} for ${thread.id}`);
		await act(async () => button.click());
	}
	function editor(container: HTMLElement, thread: AIDraftThread) {
		const input = card(container, thread).querySelector<HTMLTextAreaElement>(
			'textarea[aria-label="Edit finding"]'
		);
		if (!input) throw new Error(`Missing editor ${thread.id}`);
		return input;
	}
	async function type(container: HTMLElement, thread: AIDraftThread, value: string) {
		await act(async () => {
			const input = editor(container, thread);
			Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set?.call(
				input,
				value
			);
			input.dispatchEvent(new window.Event("input", { bubbles: true }));
			input.dispatchEvent(new window.Event("change", { bubbles: true }));
		});
	}
	test("two finding editors keep separate drafts across remount and save the correct finding", async () => {
		usePRReviewSessionStore.setState({ sessions: new Map() });
		const saved: Array<{ id: string; body: string; status: AIDraftThread["status"] }> = [];
		const callbacks = {
			onSaveEdit: (id: string, body: string, status: AIDraftThread["status"]) => {
				saved.push({ id, body, status });
			},
		};
		const subject = (reverse = false) => (
			<ReviewUIProvider scopeKey="review:two-findings">
				{(reverse ? [b, a] : [a, b]).map((thread) => (
					<FindingCard key={thread.id} thread={thread} callbacks={callbacks} />
				))}
			</ReviewUIProvider>
		);
		const h = await renderBrowserTest(subject());
		try {
			await click(h.container, a, "Edit");
			await type(h.container, a, "Unsent edit A");
			await click(h.container, b, "Edit");
			expect(editor(h.container, b).value).toBe("Original finding B");
			await type(h.container, b, "Unsent edit B");
			expect(editor(h.container, a).value).toBe("Unsent edit A");
			await h.rerender(<div />);
			await h.rerender(subject(true));
			await click(h.container, b, "Edit");
			await click(h.container, a, "Edit");
			expect(editor(h.container, a).value).toBe("Unsent edit A");
			expect(editor(h.container, b).value).toBe("Unsent edit B");
			await click(h.container, b, "Save");
			expect(saved).toEqual([{ id: b.draftCommentId, body: "Unsent edit B", status: "pending" }]);
			expect(editor(h.container, a).value).toBe("Unsent edit A");
			await click(h.container, a, "Save");
			expect(saved[1]).toEqual({ id: a.draftCommentId, body: "Unsent edit A", status: "pending" });
		} finally {
			await h.cleanup();
		}
	});
}
