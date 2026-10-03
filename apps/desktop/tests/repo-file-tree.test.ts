import { expect, test } from "bun:test";
import { act, createElement } from "react";
import { RepoFileTree } from "../src/renderer/components/RepoFileTree";
import { getAllPanes, usePaneStore } from "../src/renderer/stores/pane-store";
import { renderBrowserTest } from "./helpers/file-browser-renderer";

test("Files shows dotfiles by default and explicitly requests browser mode", async () => {
	const h = await renderBrowserTest(
		createElement(RepoFileTree, { repoPath: "/fixture/a", workspaceId: "a" })
	);
	try {
		expect(h.container.querySelector('[data-path=".env"]')).not.toBeNull();
		expect(h.calls.find((call) => call.path === "diff.listAllFiles")?.input).toMatchObject({
			repoPath: "/fixture/a",
			mode: "browser",
		});
	} finally {
		await h.cleanup();
	}
});

test("filename search finds env files; hiding is reversible and explains the search filter", async () => {
	const h = await renderBrowserTest(
		createElement(RepoFileTree, { repoPath: "/fixture/a", workspaceId: "a" })
	);
	try {
		const input = h.container.querySelector("input");
		if (!input) throw new Error("Missing search input");
		await act(async () => {
			const setter = Object.getOwnPropertyDescriptor(
				window.HTMLInputElement.prototype,
				"value"
			)?.set;
			setter?.call(input, ".env");
			input.dispatchEvent(new window.Event("input", { bubbles: true }));
		});
		expect(h.container.textContent).toContain("1/1");
		const toggle = h.container.querySelector<HTMLButtonElement>('[title="Hide dotfiles"]');
		expect(toggle?.getAttribute("aria-pressed")).toBe("true");
		await act(async () => toggle?.click());
		expect(h.container.querySelector('[data-path=".env"]')).toBeNull();
		expect(h.container.textContent).toContain("Dotfiles hidden");
		expect(h.container.textContent).toContain("search");
		await act(async () =>
			h.container.querySelector<HTMLButtonElement>('[title="Show dotfiles"]')?.click()
		);
		expect(h.container.querySelector('[data-path=".env"]')).not.toBeNull();
	} finally {
		await h.cleanup();
	}
});

test("browse, expand, search and hover request no file contents; explicit open retains the root", async () => {
	const h = await renderBrowserTest(
		createElement(RepoFileTree, { repoPath: "/fixture/b", workspaceId: "b" })
	);
	try {
		// Exercise the legacy show control too, so this regression is independent of default visibility.
		await act(async () =>
			h.container.querySelector<HTMLButtonElement>('[title="Show dotfiles"]')?.click()
		);
		const row = h.container.querySelector<HTMLElement>('[data-path=".env"]');
		expect(row).not.toBeNull();
		await act(async () =>
			row?.dispatchEvent(new window.MouseEvent("mouseover", { bubbles: true }))
		);
		expect(
			h.calls
				.map((call) => call.path)
				.every((path) => ["diff.listAllFiles", "diff.getWorkingTreeStatus"].includes(path))
		).toBe(true);
		await act(async () => row?.click());
		const layout = usePaneStore.getState().layouts["b"];
		const files = layout ? getAllPanes(layout).flatMap((pane) => pane.tabs) : [];
		expect(files).toContainEqual(
			expect.objectContaining({ workspaceId: "b", repoPath: "/fixture/b", filePath: ".env" })
		);
	} finally {
		await h.cleanup();
	}
});

test("empty and failed listings keep Refresh available and have distinct messages", async () => {
	for (const fail of [false, true]) {
		const h = await renderBrowserTest(
			createElement(RepoFileTree, { repoPath: "/fixture/empty", workspaceId: "empty" }),
			[],
			fail
		);
		try {
			expect(h.container.textContent).toContain(fail ? "Unable to load files" : "Empty workspace");
			const refresh = h.container.querySelector<HTMLButtonElement>('[title="Refresh"]');
			expect(refresh).not.toBeNull();
			const before = h.calls.filter((call) => call.path === "diff.listAllFiles").length;
			await act(async () => refresh?.click());
			await h.settle();
			expect(h.calls.filter((call) => call.path === "diff.listAllFiles").length).toBeGreaterThan(
				before
			);
		} finally {
			await h.cleanup();
		}
	}
});

test("Files owns a repository subscription and resets the hidden filter on root switch", async () => {
	const h = await renderBrowserTest(
		createElement(RepoFileTree, { repoPath: "/fixture/a", workspaceId: "a" })
	);
	try {
		expect(h.lifecycle).toContain("subscribe:/fixture/a:1");
		await act(async () =>
			h.container.querySelector<HTMLButtonElement>('[title="Hide dotfiles"]')?.click()
		);
		await h.rerender(createElement(RepoFileTree, { repoPath: "/fixture/b", workspaceId: "b" }));
		expect(h.lifecycle).toContain("unsubscribe:/fixture/a");
		expect(h.container.querySelector('[data-path=".env"]')).not.toBeNull();
	} finally {
		await h.cleanup();
	}
});

test("nested env search and compact/expanded keyboard opening retain the relative path", async () => {
	const h = await renderBrowserTest(
		createElement(RepoFileTree, { repoPath: "/fixture/nested", workspaceId: "nested" }),
		[
			{ path: "ignored/deep/.env.local", type: "file" },
			{ path: ".config/settings", type: "file" },
		]
	);
	try {
		const row = h.container.querySelector<HTMLElement>('[data-path="ignored/deep/.env.local"]');
		expect(row).not.toBeNull();
		await act(async () =>
			row?.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
		);
		const layout = usePaneStore.getState().layouts["nested"];
		expect(layout && getAllPanes(layout).flatMap((pane) => pane.tabs)).toHaveLength(1);
		expect(layout && getAllPanes(layout).flatMap((pane) => pane.tabs)).toContainEqual(
			expect.objectContaining({ repoPath: "/fixture/nested", filePath: "ignored/deep/.env.local" })
		);
		await act(async () =>
			h.container.querySelector<HTMLButtonElement>('[title="Expand folder chains"]')?.click()
		);
		await act(async () =>
			h.container.querySelector<HTMLButtonElement>('[title="Expand all"]')?.click()
		);
		expect(h.container.querySelector('[data-path="ignored/deep/.env.local"]')).not.toBeNull();
		expect(h.calls.find((call) => call.path === "diff.getWorkingTreeStatus")?.input).toMatchObject({
			metadataOnly: true,
		});
		expect(
			h.calls.every((call) =>
				["diff.listAllFiles", "diff.getWorkingTreeStatus"].includes(call.path)
			)
		).toBe(true);
	} finally {
		await h.cleanup();
	}
});

test("large browser listings retain all filenames and filename search without content requests", async () => {
	const entries = Array.from({ length: 10_000 }, (_, index) => ({
		path: `group-${Math.floor(index / 100)}/.env.${index}`,
		type: "file",
	}));
	const start = performance.now();
	const h = await renderBrowserTest(
		createElement(RepoFileTree, { repoPath: "/fixture/large", workspaceId: "large" }),
		entries
	);
	try {
		expect(h.container.querySelectorAll('[role="treeitem"]')).toHaveLength(10_100);
		expect(h.container.querySelector('[data-path="group-99/.env.9999"]')).not.toBeNull();
		console.info(
			`Browser DOM: 10,000 fixture files in ${Math.round(performance.now() - start)} ms (happy-dom)`
		);
		expect(
			h.calls.every((call) =>
				["diff.listAllFiles", "diff.getWorkingTreeStatus"].includes(call.path)
			)
		).toBe(true);
	} finally {
		await h.cleanup();
	}
}, 15000);

test("linked env files are labeled, searchable and hideable without resolving or reading targets", async () => {
	const h = await renderBrowserTest(
		createElement(RepoFileTree, { repoPath: "/fixture/links", workspaceId: "links" }),
		[{ path: "apps/desktop/.env", type: "symlink" }]
	);
	try {
		const row = h.container.querySelector<HTMLElement>('[data-path="apps/desktop/.env"]');
		expect(row?.getAttribute("aria-label")).toContain("symbolic link");
		expect(row?.querySelector('[title="Symbolic link"]')).not.toBeNull();
		const input = h.container.querySelector("input");
		if (!input) throw new Error("Missing search input");
		await act(async () => {
			Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set?.call(
				input,
				".env"
			);
			input.dispatchEvent(new window.Event("input", { bubbles: true }));
			row?.dispatchEvent(new window.MouseEvent("mouseover", { bubbles: true }));
		});
		expect(h.container.textContent).toContain("1/1");
		expect(
			h.calls.every((call) =>
				["diff.listAllFiles", "diff.getWorkingTreeStatus"].includes(call.path)
			)
		).toBe(true);
		await act(async () =>
			h.container.querySelector<HTMLButtonElement>('[title="Hide dotfiles"]')?.click()
		);
		expect(h.container.querySelector('[data-path="apps/desktop/.env"]')).toBeNull();
	} finally {
		await h.cleanup();
	}
});
