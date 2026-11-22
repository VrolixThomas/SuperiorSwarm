import { beforeEach, expect, test } from "bun:test";
import { act } from "react";
import type { ReviewPathSource } from "../src/renderer/lib/review-path-source";
import { inIsolatedFileBrowserTest } from "./helpers/isolated-file-browser-test";

if (inIsolatedFileBrowserTest(import.meta.path, "review workflow states and actions")) {
	const { renderBrowserTest } = await import("./helpers/file-browser-renderer");
	const { ReviewWorkflowBar } = await import(
		"../src/renderer/components/review-mode/ReviewWorkflowBar"
	);
	const { PR129_PATH } = await import("../src/renderer/lib/review-path-fixtures");
	const { useReviewPathSettingsStore } = await import(
		"../src/renderer/stores/review-path-settings-store"
	);
	const source = (patch: Partial<ReviewPathSource> = {}): ReviewPathSource => ({
		path: null,
		status: "none",
		available: true,
		unavailableReason: undefined,
		start: () => {},
		stop: () => {},
		retry: () => {
			throw Error("Retry must use the current selected agent");
		},
		addContextStep: () => {},
		removeContextStep: () => {},
		...patch,
	});
	const defaults = { onBrowseFiles: () => {}, onReadPath: () => {}, findingsCount: 0 };
	const request = (preset = "codex") => ({
		request: (path: string, input: unknown) => {
			if (path === "aiReview.getSettings") return { cliPreset: preset };
			if (path === "reviewPath.getSettings" || path === "reviewPath.importLegacySettings") {
				const state = useReviewPathSettingsStore.getState();
				return {
					autoMapOnReviewRequest: state.autoMapOnReviewRequest,
					alsoReview: state.alsoReview,
					defaultRailMode: state.defaultRailMode,
				};
			}
			if (path === "reviewPath.updateSettings") return input;
			throw Error(path);
		},
	});
	const findButton = (container: HTMLElement, label: string) =>
		Array.from(container.querySelectorAll("button")).find((button) => button.textContent === label);
	const click = async (container: HTMLElement, label: string) => {
		const button = findButton(container, label);
		expect(button).toBeDefined();
		await act(async () => button?.click());
	};
	const chooseAgent = async (container: HTMLElement, value: string) => {
		const select = container.querySelector<HTMLSelectElement>('select[aria-label="Review agent"]');
		expect(select).not.toBeNull();
		await act(async () => {
			if (select) {
				select.value = value;
				select.dispatchEvent(new window.Event("change", { bubbles: true }));
			}
		});
	};
	beforeEach(() =>
		useReviewPathSettingsStore.setState({
			alsoReview: true,
			autoMapOnReviewRequest: false,
			defaultRailMode: "auto",
			error: undefined,
		})
	);

	test("one primary start uses configured agent and also-review setting; explicit selection controls retry", async () => {
		const launches: unknown[] = [];
		let browses = 0;
		useReviewPathSettingsStore.setState({ alsoReview: false });
		const s = source({ start: (options) => launches.push(options) });
		const h = await renderBrowserTest(
			<ReviewWorkflowBar
				{...defaults}
				source={s}
				onBrowseFiles={() => {
					browses++;
				}}
			/>,
			[],
			false,
			request()
		);
		try {
			expect(h.container.querySelector<HTMLSelectElement>("select")?.value).toBe("codex");
			expect(h.container.textContent).toContain("1 Choose how to review");
			expect(
				Array.from(h.container.querySelectorAll("button")).filter(
					(button) => button.textContent === "Start agent review"
				)
			).toHaveLength(1);
			await click(h.container, "Start agent review");
			expect(launches).toEqual([{ agentId: "codex", alsoReview: false }]);
			await chooseAgent(h.container, "claude");
			await h.rerender(
				<ReviewWorkflowBar
					{...defaults}
					source={{ ...s, status: "failed", agentSessionStarted: false }}
					onBrowseFiles={() => {
						browses++;
					}}
				/>
			);
			await click(h.container, "Retry agent review");
			expect(launches[1]).toEqual({ agentId: "claude", alsoReview: false });
			await click(h.container, "Browse files");
			expect(browses).toBe(1);
			expect(h.container.querySelector("details")?.open).toBe(false);
			expect(h.container.querySelectorAll('details input[type="checkbox"]')).toHaveLength(1);
		} finally {
			await h.cleanup();
		}
	});

	test("preparation overrides an old failure and offers browsing without a fake Stop or old terminal", async () => {
		let calls = 0;
		const h = await renderBrowserTest(
			<ReviewWorkflowBar
				{...defaults}
				compact
				source={source({
					starting: true,
					status: "failed",
					path: { ...PR129_PATH, status: "failed", error: "OLD FAILURE" },
					unavailableReason: "OLD ERROR",
					start: () => {
						calls++;
					},
					stop: () => {
						calls++;
					},
				})}
				onBrowseFiles={() => {
					calls++;
				}}
				onOpenAgent={() => {
					calls++;
				}}
			/>,
			[],
			false,
			request()
		);
		try {
			expect(h.container.textContent).toContain("Preparing Codex workspace");
			expect(h.container.textContent).toContain("The agent has not started yet");
			expect(h.container.textContent).not.toContain("OLD");
			expect(h.container.textContent).not.toContain("Agent did not start");
			expect(findButton(h.container, "Preparing…")?.disabled).toBe(true);
			expect(findButton(h.container, "Stop")).toBeUndefined();
			expect(findButton(h.container, "Open agent workspace")).toBeUndefined();
			expect(h.container.querySelector<HTMLSelectElement>("select")?.disabled).toBe(true);
			await click(h.container, "Preparing…");
			expect(calls).toBe(0);
			await click(h.container, "Browse files");
			expect(calls).toBe(1);
		} finally {
			await h.cleanup();
		}
	});

	test("mapping reports actual session and counts, with agent workspace and Stop actions", async () => {
		let opens = 0;
		let stops = 0;
		const s = source({
			status: "mapping",
			agentSessionStarted: true,
			path: {
				...PR129_PATH,
				agent: { id: "claude-code", label: "Claude Code" },
				status: "mapping",
				progress: { placed: 2, total: 7 },
			},
			stop: () => {
				stops++;
			},
		});
		const h = await renderBrowserTest(
			<ReviewWorkflowBar
				{...defaults}
				source={s}
				onOpenAgent={() => {
					opens++;
				}}
			/>,
			[],
			false,
			request()
		);
		try {
			expect(h.container.textContent).toContain("Agent session started");
			expect(h.container.textContent).toContain("2 of 7 files organized");
			expect(h.container.textContent).not.toContain("%");
			expect(h.container.querySelector<HTMLSelectElement>("select")?.value).toBe("claude");
			await click(h.container, "Open agent workspace");
			await click(h.container, "Stop");
			expect(opens).toBe(1);
			expect(stops).toBe(1);
			await h.rerender(
				<ReviewWorkflowBar
					{...defaults}
					source={{ ...s, path: { ...PR129_PATH, status: "mapping", progress: undefined } }}
					onOpenAgent={() => {
						opens++;
					}}
				/>
			);
			expect(h.container.textContent).not.toContain("files organized");
		} finally {
			await h.cleanup();
		}
	});

	test("a persisted mapping without a session is still preparation", async () => {
		const h = await renderBrowserTest(
			<ReviewWorkflowBar
				{...defaults}
				source={source({
					status: "mapping",
					agentSessionStarted: false,
					path: { ...PR129_PATH, status: "mapping" },
				})}
			/>,
			[],
			false,
			request()
		);
		try {
			expect(h.container.textContent).toContain("has not started yet");
			expect(h.container.textContent).not.toContain("Agent session started");
			expect(findButton(h.container, "Stop")).toBeUndefined();
		} finally {
			await h.cleanup();
		}
	});

	test("ready results provide a clear next step and move rerun under options", async () => {
		const calls: string[] = [];
		const launches: unknown[] = [];
		const h = await renderBrowserTest(
			<ReviewWorkflowBar
				{...defaults}
				compact
				source={source({
					status: "ready",
					path: PR129_PATH,
					start: (options) => launches.push(options),
				})}
				findingsCount={3}
				onBrowseFiles={() => calls.push("browse")}
				onReadPath={() => calls.push("path")}
				onOpenFindings={() => calls.push("findings")}
				onOpenAgent={() => calls.push("agent")}
			/>,
			[],
			false,
			request()
		);
		try {
			expect(h.container.querySelector<HTMLSelectElement>("select")?.value).toBe("claude");
			expect(h.container.textContent).not.toContain("1 Choose how to review");
			expect(findButton(h.container, "Run again")?.closest("details")?.open).toBe(false);
			for (const label of [
				"Follow reading path",
				"Review findings · 3",
				"Open agent workspace",
				"Browse files",
			])
				await click(h.container, label);
			expect(calls).toEqual(["path", "findings", "agent", "browse"]);
			await chooseAgent(h.container, "codex");
			await click(h.container, "Run again");
			expect(launches).toEqual([{ agentId: "codex", alsoReview: true }]);
		} finally {
			await h.cleanup();
		}
	});

	for (const started of [false, true])
		test(`failure is truthful about whether a session started (${started})`, async () => {
			const h = await renderBrowserTest(
				<ReviewWorkflowBar
					{...defaults}
					source={source({
						status: "failed",
						agentSessionStarted: started,
						path: { ...PR129_PATH, status: "failed", error: "Synthetic launch diagnostic" },
					})}
				/>,
				[],
				false,
				request()
			);
			try {
				expect(h.container.textContent).toContain(
					started ? "Agent review stopped" : "Agent did not start"
				);
				expect(h.container.textContent).toContain("You can browse the files or try again.");
				const details = Array.from(h.container.querySelectorAll("details")).find((node) =>
					node.textContent?.includes("Synthetic launch diagnostic")
				);
				expect(details?.open).toBe(false);
				expect(findButton(h.container, "Retry agent review")?.disabled).toBe(false);
			} finally {
				await h.cleanup();
			}
		});

	test("stale results request a fresh agent review and unsupported defaults require an explicit choice", async () => {
		const launches: unknown[] = [];
		const h = await renderBrowserTest(
			<ReviewWorkflowBar
				{...defaults}
				source={source({
					status: "stale",
					path: PR129_PATH,
					start: (value) => launches.push(value),
				})}
			/>,
			[],
			false,
			request("gemini")
		);
		try {
			expect(h.container.textContent).toContain("PR changed since this review");
			expect(findButton(h.container, "Update agent review")?.disabled).toBe(true);
			await chooseAgent(h.container, "codex");
			await click(h.container, "Update agent review");
			expect(launches).toEqual([{ agentId: "codex", alsoReview: true }]);
		} finally {
			await h.cleanup();
		}
	});

	test("waiting for agent settings disables launch without claiming workspace preparation", async () => {
		let finish!: (settings: { cliPreset: string }) => void;
		const pending = new Promise<{ cliPreset: string }>((resolve) => {
			finish = resolve;
		});
		let launches = 0;
		const h = await renderBrowserTest(
			<ReviewWorkflowBar
				{...defaults}
				source={source({
					start: () => {
						launches++;
					},
				})}
			/>,
			[],
			false,
			{ request: () => pending }
		);
		try {
			expect(findButton(h.container, "Start agent review")?.disabled).toBe(true);
			expect(h.container.textContent).toContain("Loading review agent settings");
			expect(h.container.textContent).not.toContain("Preparing");
			await click(h.container, "Start agent review");
			expect(launches).toBe(0);
			await act(async () => {
				finish({ cliPreset: "codex" });
			});
			await h.settle();
			expect(findButton(h.container, "Start agent review")?.disabled).toBe(false);
		} finally {
			finish({ cliPreset: "codex" });
			await h.cleanup();
		}
	});

	for (const status of ["none", "failed", "stale", "ready"] as const)
		test(`closed PR ${status} permits browsing/results but cannot start an agent`, async () => {
			let starts = 0;
			let browses = 0;
			let paths = 0;
			const h = await renderBrowserTest(
				<ReviewWorkflowBar
					{...defaults}
					readOnly
					source={source({
						status,
						path: status === "none" ? null : PR129_PATH,
						start: () => {
							starts++;
						},
					})}
					onBrowseFiles={() => {
						browses++;
					}}
					onReadPath={() => {
						paths++;
					}}
				/>,
				[],
				false,
				request()
			);
			try {
				const launchLabel =
					status === "ready"
						? "Run again"
						: status === "stale"
							? "Update agent review"
							: status === "failed"
								? "Retry agent review"
								: "Start agent review";
				expect(findButton(h.container, launchLabel)?.disabled).toBe(true);
				await click(h.container, launchLabel);
				expect(starts).toBe(0);
				await click(h.container, "Browse files");
				expect(browses).toBe(1);
				if (status === "ready") {
					await click(h.container, "Follow reading path");
					expect(paths).toBe(1);
				}
			} finally {
				await h.cleanup();
			}
		});
}
