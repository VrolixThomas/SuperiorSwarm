import { expect, test } from "bun:test";
import { act } from "react";
import type { UnifiedThread } from "../src/shared/github-types";
import type { AskMessage } from "../src/shared/review-path-types";
import { inIsolatedFileBrowserTest } from "./helpers/isolated-file-browser-test";

if (inIsolatedFileBrowserTest(import.meta.path, "reading path panels in isolation")) {
	const { renderBrowserTest } = await import("./helpers/file-browser-renderer");
	const { ThreadsTab } = await import("../src/renderer/components/review-mode/panel/ThreadsTab");
	const { AskTab } = await import("../src/renderer/components/review-mode/panel/AskTab");
	const { FindingCard } = await import("../src/renderer/components/review-mode/thread/FindingCard");
	const { PR129_PATH } = await import("../src/renderer/lib/review-path-fixtures");
	const file = PR129_PATH.entries[0]?.steps[2]?.path;
	if (!file) throw new Error("Missing fixture step");
	const comment = {
		id: "c",
		body: "Please check this",
		author: "alice",
		authorAvatarUrl: "",
		createdAt: "",
	};
	const threads: UnifiedThread[] = [
		{
			id: "open",
			path: file,
			line: 390,
			diffSide: "RIGHT",
			isResolved: false,
			comments: [comment],
		},
		{
			id: "old",
			path: file,
			line: 112,
			originalLine: 112,
			isOutdated: true,
			diffSide: "RIGHT",
			isResolved: false,
			comments: [{ ...comment, author: "bob" }],
		},
		{
			id: "resolved",
			path: "other.ts",
			line: 5,
			diffSide: "RIGHT",
			isResolved: true,
			comments: [comment],
		},
	];
	test("threads group by numbered step, filter mine/resolved, and preserve outdated anchors", async () => {
		const opened: UnifiedThread[] = [];
		const h = await renderBrowserTest(
			<ThreadsTab
				threads={threads}
				path={PR129_PATH}
				currentUser="alice"
				onOpen={(thread) => opened.push(thread)}
				onAsk={() => {}}
			/>
		);
		try {
			expect(h.container.textContent).toContain("3 · ai-review.ts");
			expect(h.container.textContent).toContain("was line 112");
			expect(h.container.textContent).toContain("on an earlier version");
			await act(async () =>
				h.container.querySelector<HTMLButtonElement>('[data-thread-id="old"]')?.click()
			);
			expect(opened[0]?.id).toBe("old");
			await act(async () =>
				h.container.querySelector<HTMLButtonElement>('[data-filter="mine"]')?.click()
			);
			expect(h.container.querySelector('[data-thread-id="old"]')).toBeNull();
			expect(h.container.querySelector('[data-thread-id="resolved"]')).not.toBeNull();
			await act(async () =>
				h.container.querySelector<HTMLButtonElement>('[data-filter="resolved"]')?.click()
			);
			expect(h.container.querySelector('[data-thread-id="open"]')).toBeNull();
		} finally {
			await h.cleanup();
		}
	});
	test("Ask references route and Add as comment preserves the answer anchor and body", async () => {
		const anchor = { path: file, side: "RIGHT" as const, startLine: 387, endLine: 392 };
		const message: AskMessage = {
			id: "a",
			role: "agent",
			text: "An empty body clears the summary.",
			anchor,
			refs: [{ path: "publisher.ts", line: 249, description: "Publisher" }],
			createdAt: "",
		};
		let draft: { body: string; anchor: NonNullable<AskMessage["anchor"]> } | undefined;
		let target = "";
		const h = await renderBrowserTest(
			<AskTab
				messages={[message]}
				anchor={anchor}
				available
				onSend={() => {}}
				onReference={(ref) => {
					target = `${ref.path}:${ref.line}`;
				}}
				onAddComment={(body, anchor) => {
					draft = { body, anchor };
				}}
			/>
		);
		try {
			expect(h.container.textContent).toContain("ai-review.ts · 387–392");
			await act(async () =>
				h.container.querySelector<HTMLButtonElement>("[data-reference]")?.click()
			);
			expect(target).toBe("publisher.ts:249");
			await act(async () =>
				h.container.querySelector<HTMLButtonElement>("[data-add-comment]")?.click()
			);
			expect(draft).toEqual({ body: message.text, anchor });
			await h.rerender(
				<AskTab
					messages={[]}
					anchor={anchor}
					available={false}
					onSend={() => {}}
					onReference={() => {}}
				/>
			);
			expect(h.container.querySelector<HTMLTextAreaElement>("textarea")?.disabled).toBe(true);
			expect(h.container.textContent).toContain("Agent not connected yet");
		} finally {
			await h.cleanup();
		}
	});
	test("finding callbacks use draft id and read-only findings have no mutation actions", async () => {
		const finding = {
			id: "ai:f",
			isAIDraft: true as const,
			draftCommentId: "f",
			path: file,
			line: 390,
			diffSide: "RIGHT" as const,
			body: "Check this",
			status: "pending" as const,
			category: "Correctness",
			userEdit: null,
			createdAt: "",
		};
		let accepted = "";
		const h = await renderBrowserTest(
			<FindingCard
				thread={finding}
				callbacks={{
					onAccept: (id) => {
						accepted = id;
					},
				}}
				onAsk={() => {}}
			/>
		);
		try {
			await act(async () =>
				[...h.container.querySelectorAll("button")].find((b) => b.textContent === "Accept")?.click()
			);
			expect(accepted).toBe("f");
			await h.rerender(<FindingCard thread={finding} callbacks={{}} onAsk={() => {}} />);
			expect(
				[...h.container.querySelectorAll("button")].some((b) => b.textContent === "Accept")
			).toBe(false);
		} finally {
			await h.cleanup();
		}
	});
}
