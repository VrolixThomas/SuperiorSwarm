import { expect, test } from "bun:test";
import { act } from "react";
import type { ReviewPathSource } from "../src/renderer/lib/review-path-source";
import type { UnifiedThread } from "../src/shared/github-types";
import { inIsolatedFileBrowserTest } from "./helpers/isolated-file-browser-test";

if (inIsolatedFileBrowserTest(import.meta.path, "reading path rail in isolation")) {
	const { renderBrowserTest } = await import("./helpers/file-browser-renderer");
	const { ReviewRail } = await import("../src/renderer/components/review-mode/rail/ReviewRail");
	const { PR129_PATH, PR129_FILES } = await import("../src/renderer/lib/review-path-fixtures");
	const { railItems, selectableRailItems } = await import("../src/renderer/lib/review-path-model");
	const { useReviewPathSettingsStore } = await import(
		"../src/renderer/stores/review-path-settings-store"
	);
	const source = (patch: Partial<ReviewPathSource> = {}): ReviewPathSource => ({
		path: PR129_PATH,
		status: "ready",
		available: true,
		unavailableReason: undefined,
		start: () => {},
		stop: () => {},
		retry: () => {},
		addContextStep: () => {},
		removeContextStep: () => {},
		...patch,
	});
	const base = {
		source: source(),
		files: PR129_FILES,
		threads: [],
		viewed: new Set<string>(),
		selectedPath: null,
		mode: null,
		onModeChange: () => {},
		onSelect: () => {},
	};
	const options = {
		request: (path: string, input: unknown) => {
			if (path === "aiReview.getSettings") return { cliPreset: "codex" };
			if (path === "reviewPath.getSettings" || path === "reviewPath.importLegacySettings") {
				const state = useReviewPathSettingsStore.getState();
				return {
					autoMapOnReviewRequest: state.autoMapOnReviewRequest,
					alsoReview: state.alsoReview,
					defaultRailMode: state.defaultRailMode,
				};
			}
			if (path === "reviewPath.updateSettings") return input;
			throw new Error(path);
		},
	};
	test("fixture renders numbered steps, nested tests, context, independent counts and selected row", async () => {
		const selected = PR129_PATH.entries[0]?.steps[2]?.path;
		if (!selected) throw new Error("Missing fixture step");
		const threads: UnifiedThread[] = [
			{ id: "open", path: selected, line: 1, diffSide: "RIGHT", comments: [], isResolved: false },
			{ id: "closed", path: selected, line: 1, diffSide: "RIGHT", comments: [], isResolved: true },
			{
				id: "ai",
				isAIDraft: true,
				draftCommentId: "ai",
				path: selected,
				line: 1,
				diffSide: "RIGHT",
				body: "finding",
				status: "pending",
				userEdit: null,
				createdAt: "",
			},
		];
		const h = await renderBrowserTest(
			<ReviewRail {...base} selectedPath={selected} threads={threads} />,
			[],
			false,
			options
		);
		try {
			expect(h.container.querySelectorAll('[data-rail-kind="step"]')).toHaveLength(8);
			expect(h.container.querySelectorAll('[data-rail-kind="test"]')).toHaveLength(5);
			expect(h.container.querySelectorAll('[data-rail-kind="context"]')).toHaveLength(1);
			expect(
				[...h.container.querySelectorAll("[data-step-number]")].map((row) =>
					row.getAttribute("data-step-number")
				)
			).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);
			const current = h.container.querySelector('[aria-current="step"]');
			expect(current?.getAttribute("data-path")).toBe(selected);
			expect(current?.className).toContain("bg-[var(--bg-overlay)]");
			expect(current?.className).not.toMatch(/inset|border-l/);
			expect(current?.querySelector('[aria-label="1 open thread"]')).not.toBeNull();
			expect(current?.querySelector('[aria-label="1 pending finding"]')).not.toBeNull();
		} finally {
			await h.cleanup();
		}
	});
	test("live missing path explains unavailable mapping and retains all files in model order", async () => {
		const h = await renderBrowserTest(
			<ReviewRail
				{...base}
				source={source({
					path: null,
					status: "none",
					available: false,
					unavailableReason: "Reading-path agent is not connected yet.",
				})}
			/>,
			[],
			false,
			options
		);
		try {
			expect(h.container.textContent).toContain("No reading path yet");
			expect(h.container.textContent).toContain("Reading-path agent is not connected yet.");
			expect(
				[...h.container.querySelectorAll<HTMLButtonElement>("button")].find(
					(b) => b.textContent === "Map this PR"
				)?.disabled
			).toBe(true);
			expect(
				[...h.container.querySelectorAll("[data-path]")].map((row) => row.getAttribute("data-path"))
			).toEqual(
				selectableRailItems(railItems(null, PR129_FILES, "files")).map((item) => item.path)
			);
			expect(
				h.container.querySelector<HTMLSelectElement>('select[aria-label="Mapping agent"]')?.value
			).toBe("codex");
		} finally {
			await h.cleanup();
		}
	});
	test("Files mode groups in provider order and shows associated test counts", async () => {
		const h = await renderBrowserTest(<ReviewRail {...base} mode="files" />, [], false, options);
		try {
			expect(
				[...h.container.querySelectorAll("[data-folder]")].map((row) =>
					row.getAttribute("data-folder")
				)
			).toEqual(
				railItems(PR129_PATH, PR129_FILES, "files")
					.filter((item) => item.kind === "folder")
					.map((item) => ("title" in item ? item.title : ""))
			);
			expect(h.container.querySelector('[aria-label="2 tests"]')).not.toBeNull();
		} finally {
			await h.cleanup();
		}
	});
	test("keyboard selection reveals collapsed other files and missing path coverage", async () => {
		const missing = "new/omitted.ts";
		const h = await renderBrowserTest(
			<ReviewRail {...base} files={[...PR129_FILES, { path: missing }]} />,
			[],
			false,
			options
		);
		try {
			expect(h.container.querySelector(`[data-path="${missing}"]`)).toBeNull();
			await h.rerender(
				<ReviewRail {...base} files={[...PR129_FILES, { path: missing }]} selectedPath={missing} />
			);
			expect(h.container.querySelector('[aria-current="step"]')?.getAttribute("data-path")).toBe(
				missing
			);
		} finally {
			await h.cleanup();
		}
	});
	test("large file lists virtualize and scroll to a newly keyboard-selected row", async () => {
		const files = Array.from({ length: 180 }, (_, n) => ({ path: `src/file-${n}.ts` }));
		const h = await renderBrowserTest(
			<ReviewRail {...base} files={files} mode="files" />,
			[],
			false,
			options
		);
		try {
			expect(h.container.querySelectorAll("[data-path]").length).toBeLessThan(60);
			await h.rerender(
				<ReviewRail {...base} files={files} mode="files" selectedPath="src/file-179.ts" />
			);
			expect(h.container.querySelector('[aria-current="step"]')?.getAttribute("data-path")).toBe(
				"src/file-179.ts"
			);
			expect(
				h.container.querySelector<HTMLElement>("[data-rail-scroll]")?.scrollTop
			).toBeGreaterThan(0);
		} finally {
			await h.cleanup();
		}
	});
	test("mapping controls use configured agent and persisted options", async () => {
		let received: unknown;
		useReviewPathSettingsStore.setState({
			alsoReview: false,
			autoMapOnReviewRequest: false,
			defaultRailMode: "auto",
		});
		const h = await renderBrowserTest(
			<ReviewRail
				{...base}
				source={source({
					path: null,
					status: "none",
					start: (options) => {
						received = options;
					},
				})}
			/>,
			[],
			false,
			options
		);
		try {
			await act(async () =>
				[...h.container.querySelectorAll<HTMLButtonElement>("button")]
					.find((b) => b.textContent === "Map this PR")
					?.click()
			);
			expect(received).toEqual({ agentId: "codex", alsoReview: false });
			await act(async () =>
				h.container
					.querySelector<HTMLInputElement>('input[aria-label="Also review the code"]')
					?.click()
			);
			await h.settle();
			expect(useReviewPathSettingsStore.getState().alsoReview).toBe(true);
		} finally {
			await h.cleanup();
		}
	});
	test("selection calls back without marking viewed; rail resize stays within bounds", async () => {
		let selected: string | undefined;
		const viewed = new Set<string>();
		const h = await renderBrowserTest(
			<ReviewRail
				{...base}
				viewed={viewed}
				onSelect={(item) => {
					selected = item.path;
				}}
			/>,
			[],
			false,
			options
		);
		try {
			const row = h.container.querySelector<HTMLButtonElement>("[data-path]");
			await act(async () => row?.click());
			expect(selected).toBe(row?.getAttribute("data-path") ?? undefined);
			expect(viewed.size).toBe(0);
			const separator = h.container.querySelector('[role="separator"]');
			for (const [key, expected] of [
				["ArrowLeft", "240"],
				["ArrowRight", "360"],
			]) {
				await act(async () => {
					for (let n = 0; n < 10; n++)
						separator?.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true }));
				});
				expect(separator?.getAttribute("aria-valuenow")).toBe(expected);
			}
			await h.rerender(<ReviewRail {...base} collapsed />);
			expect(h.container.querySelector("nav")).toBeNull();
		} finally {
			await h.cleanup();
		}
	});
	test("mapping, stale and failed paths expose honest actions and provider viewed support", async () => {
		let stops = 0;
		const mapping = source({
			status: "mapping",
			path: {
				...PR129_PATH,
				status: "mapping",
				progress: { placed: 13, total: 17, currentFile: "src/tab-store.ts" },
			},
			stop: () => {
				stops++;
			},
		});
		const h = await renderBrowserTest(
			<ReviewRail {...base} source={mapping} showViewed={false} />,
			[],
			false,
			options
		);
		try {
			expect(h.container.textContent).toContain("is reading tab-store.ts");
			expect(h.container.textContent).toContain("Not placed yet");
			expect(h.container.textContent).not.toContain("of 17 viewed");
			expect(h.container.querySelectorAll('[aria-label="Mapping next step"]')).toHaveLength(2);
			await act(async () =>
				[...h.container.querySelectorAll<HTMLButtonElement>("button")]
					.find((b) => b.textContent === "Stop")
					?.click()
			);
			expect(stops).toBe(1);
			await h.rerender(
				<ReviewRail
					{...base}
					source={source({ status: "stale", path: { ...PR129_PATH, status: "stale" } })}
				/>
			);
			expect(h.container.textContent).toContain("Path is from an older commit");
			await h.rerender(
				<ReviewRail
					{...base}
					mode="path"
					source={source({
						status: "failed",
						path: { ...PR129_PATH, status: "failed", error: "Mapping stopped." },
					})}
				/>
			);
			expect(h.container.querySelector('nav[aria-label="Changed files"]')).not.toBeNull();
			expect(h.container.textContent).toContain("Retry mapping");
			expect(h.container.textContent).toContain("Mapping stopped.");
		} finally {
			await h.cleanup();
		}
	});
}
