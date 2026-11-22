import { expect, test } from "bun:test";
import { act } from "react";
import { inIsolatedFileBrowserTest } from "./helpers/isolated-file-browser-test";

if (inIsolatedFileBrowserTest(import.meta.path, "PR overview navigation in isolation")) {
	const { renderBrowserTest } = await import("./helpers/file-browser-renderer");
	const { AllPRsDrawer } = await import(
		"../src/renderer/components/review-mode/queue/AllPRsDrawer"
	);
	const row = (number: number, title: string, author: string) => ({
		key: `bitbucket:team/portal#${number}`,
		provider: "bitbucket" as const,
		owner: "team",
		repo: "portal",
		number,
		title,
		sourceBranch: "feature",
		author,
		fileCount: 0,
		headCommitSha: "abcdef123456",
	});
	const queue = {
		needsReview: [
			row(1, "Fix settlement calculation", "Alice"),
			row(2, "Add reconciliation endpoint", "Bob"),
		],
		waitingOnAuthor: [row(3, "Update validation rules", "Carol")],
	};
	test("shows review sections, current PR and searchable author context without invalid revision calls", async () => {
		let selected = 0;
		let closed = false;
		const h = await renderBrowserTest(
			<AllPRsDrawer
				queue={queue}
				currentKey={queue.needsReview[0]?.key ?? ""}
				factsByKey={new Map([["bitbucket:team/portal#1", { viewed: { viewed: 0, total: 112 } }]])}
				onSelect={(pr) => {
					selected = pr.number;
				}}
				onClose={() => {
					closed = true;
				}}
			/>
		);
		try {
			expect(h.container.querySelector('[aria-label="Pull request overview"]')).not.toBeNull();
			expect(h.container.textContent).toContain("Needs your review");
			expect(h.container.textContent).toContain("Alice");
			expect(h.container.textContent).not.toContain("0 files");
			expect(h.container.querySelector('[aria-current="page"]')?.textContent).toContain(
				"112 files"
			);
			expect(h.container.querySelector('[aria-current="page"]')?.textContent).toContain(
				"Fix settlement"
			);
			const search = h.container.querySelector<HTMLInputElement>(
				'input[aria-label="Filter pull requests"]'
			);
			await act(async () => {
				if (search) {
					Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set?.call(
						search,
						"Bob"
					);
					search.dispatchEvent(new window.Event("input", { bubbles: true }));
				}
			});
			expect(h.container.textContent).not.toContain("Fix settlement calculation");
			expect(h.container.textContent).toContain("Add reconciliation endpoint");
			await act(async () =>
				h.container
					.querySelector<HTMLButtonElement>('[data-pr-key="bitbucket:team/portal#2"]')
					?.click()
			);
			expect(selected).toBe(2);
			const first = h.container.querySelector<HTMLButtonElement>('[aria-label="Back to review"]');
			const summary = h.container.querySelector<HTMLElement>("details > summary");
			await act(async () => {
				summary?.focus();
				summary?.dispatchEvent(
					new window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })
				);
			});
			expect(document.activeElement).toBe(first);
			await act(async () => {
				first?.dispatchEvent(
					new window.KeyboardEvent("keydown", {
						key: "Tab",
						shiftKey: true,
						bubbles: true,
						cancelable: true,
					})
				);
			});
			expect(document.activeElement).toBe(summary);
			await act(async () =>
				h.container.querySelector<HTMLButtonElement>('[aria-label="Back to review"]')?.click()
			);
			expect(closed).toBe(true);
			expect(h.calls.some((call) => call.path === "reviewPath.status")).toBe(false);
		} finally {
			await h.cleanup();
		}
	});
}
