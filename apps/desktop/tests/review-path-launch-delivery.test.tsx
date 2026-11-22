import { expect, test } from "bun:test";
import { act } from "react";
import type { PRContext } from "../src/shared/github-types";
import type { ReviewAgentJob } from "../src/shared/review-agent-job";
import type { ReviewPathIdentity, ReviewPathSnapshot } from "../src/shared/review-path-runtime";
import { inIsolatedFileBrowserTest } from "./helpers/isolated-file-browser-test";
if (inIsolatedFileBrowserTest(import.meta.path, "late reading-path launch delivery in isolation")) {
	const { renderBrowserTest } = await import("./helpers/file-browser-renderer");
	const { useReviewPath } = await import("../src/renderer/lib/review-path-source");
	const { useAskAgent } = await import("../src/renderer/components/review-mode/panel/useAskAgent");
	const pr: PRContext = {
		provider: "github",
		owner: "o",
		repo: "r",
		number: 1,
		title: "PR",
		sourceBranch: "feature",
		targetBranch: "main",
		repoPath: "/isolated",
	};
	const identity: ReviewPathIdentity = {
		workspaceId: "w",
		provider: "github",
		owner: "o",
		repo: "r",
		prNumber: 1,
		headSha: "a".repeat(40),
	};
	const snapshot = (identity: ReviewPathIdentity): ReviewPathSnapshot => ({
		identity,
		path: null,
		pathVersion: 0,
		conversationId: "c",
		messages: [],
		questions: [],
		runs: [],
	});
	for (const mode of ["map", "ask"] as const)
		for (const transition of ["head", "workspace", "unmount"] as const)
			test(`${mode} late acceptance after ${transition} preserves the owned background tab without stealing focus`, async () => {
				const { useTabStore } = await import("../src/renderer/stores/tab-store");
				const { usePaneStore } = await import("../src/renderer/stores/pane-store");
				const { observeReviewAgentJob } = await import("../src/renderer/lib/review-agent-jobs");
				usePaneStore.setState({ layouts: {}, focusedPaneId: null });
				useTabStore.setState({
					workspaceMetadata: {},
					activeWorkspaceId: null,
					activeWorkspaceCwd: "",
				});
				const current = { ...identity, workspaceId: `late-${mode}-${transition}` };
				const tabs = useTabStore.getState();
				tabs.ensureReviewTab(current.workspaceId, pr);
				tabs.setActiveWorkspace(current.workspaceId, pr.repoPath);
				const attached: string[] = [];
				let created = 0;
				let release: ((value: ReviewAgentJob) => void) | undefined;
				function Harness({ current }: { current: ReviewPathIdentity }) {
					const onLaunch = (launch: { terminalId?: string }) => {
						if (launch.terminalId) attached.push(launch.terminalId);
					};
					const path = useReviewPath(
						pr,
						{ headCommitOid: current.headSha },
						{ identity: current, onLaunch }
					);
					const ask = useAskAgent(pr, { identity: current, onLaunch });
					return (
						<button
							type="button"
							onClick={() =>
								mode === "map"
									? path.start({ agentId: "codex", alsoReview: false })
									: ask.send("Why?")
							}
						>
							Start
						</button>
					);
				}
				const h = await renderBrowserTest(<Harness current={current} />, [], false, {
					electron: {
						terminal: {
							create: () => {
								created++;
							},
						},
					},
					request: (path, input) => {
						if (path === "reviewPath.get")
							return snapshot((input as { identity: ReviewPathIdentity }).identity);
						if (path === "reviewPath.jobs") return [];
						if (path === "reviewPath.startJob" || path === "reviewPath.askJob")
							return new Promise<ReviewAgentJob>((resolve) => {
								release = resolve;
							});
						if (path === "aiReview.getSettings") return { cliPreset: "codex" };
						if (path.includes("Settings"))
							return { autoMapOnReviewRequest: false, alsoReview: false, defaultRailMode: "auto" };
						throw Error(path);
					},
				});
				let cleaned = false;
				try {
					await act(async () => h.container.querySelector("button")?.click());
					await h.settle();
					if (!release) throw Error("No pending job acceptance");
					if (transition === "head")
						await h.rerender(<Harness current={{ ...current, headSha: "b".repeat(40) }} />);
					else if (transition === "workspace") {
						const next = { ...current, workspaceId: `other-${mode}`, prNumber: 2 };
						tabs.ensureReviewTab(next.workspaceId, { ...pr, number: 2 });
						tabs.setActiveWorkspace(next.workspaceId, "/other");
						await h.rerender(<Harness current={next} />);
					} else {
						await h.cleanup();
						cleaned = true;
					}
					const activeWorkspace = useTabStore.getState().activeWorkspaceId;
					const activeTab = tabs.getActiveTabId();
					const focused = usePaneStore.getState().focusedPaneId;
					const job: ReviewAgentJob = {
						id: `job-${mode}-${transition}`,
						identity: current,
						agent: { id: "codex", label: "Codex" },
						kind: mode === "map" ? "mapping" : "question",
						state: "queued",
						phase: "queued",
						startedAt: "2026-11-22T12:00:00Z",
						updatedAt: "2026-11-22T12:00:00Z",
						attempt: 1,
						trigger: "manual",
						activity: [],
					};
					await act(async () => release?.(job));
					await h.settle();
					const owned = tabs
						.getTabsByWorkspace(current.workspaceId)
						.filter((t) => t.kind === "review-agent");
					expect(owned).toHaveLength(1);
					expect(owned[0]).toMatchObject({
						jobId: job.id,
						workspaceId: current.workspaceId,
						state: "queued",
					});
					const running = {
						...job,
						state: "running" as const,
						terminalId: `review-path:${job.id}:1`,
						cwd: "/isolated",
					};
					observeReviewAgentJob(running);
					observeReviewAgentJob(running);
					expect(
						tabs.getTabsByWorkspace(current.workspaceId).filter((t) => t.kind === "review-agent")
					).toHaveLength(1);
					expect(useTabStore.getState().activeWorkspaceId).toBe(activeWorkspace);
					expect(tabs.getActiveTabId()).toBe(activeTab);
					expect(usePaneStore.getState().focusedPaneId).toBe(focused);
					expect(attached).toEqual([]);
					expect(created).toBe(0);
				} finally {
					if (!cleaned) await h.cleanup();
				}
			});
	test("a late job acknowledgement never overwrites a newer snapshot; legacy launch results still deliver", async () => {
		const { createLiveReviewPathController } = await import(
			"../src/renderer/lib/review-path-source"
		);
		let accept: ((value: { job: ReviewAgentJob }) => void) | undefined;
		let answer:
			| ((value: { snapshot: ReviewPathSnapshot; launch: { terminalId: string } }) => void)
			| undefined;
		const controller = createLiveReviewPathController(identity, {
			get: async () => snapshot(identity),
			start: () =>
				new Promise((resolve) => {
					accept = resolve;
				}),
			ask: () =>
				new Promise((resolve) => {
					answer = resolve;
				}),
			cancel: async () => snapshot(identity),
			cancelQuestion: async () => snapshot(identity),
			addContext: async () => snapshot(identity),
			removeContext: async () => snapshot(identity),
		});
		await controller.refresh();
		const mapping = controller.start({ id: "codex", label: "Codex" }, false);
		const asking = controller.ask("q", "Why?");
		answer?.({
			snapshot: { ...snapshot(identity), pathVersion: 2 },
			launch: { terminalId: "legacy-owned-question" },
		});
		expect((await asking)?.launch?.terminalId).toBe("legacy-owned-question");
		accept?.({
			job: {
				id: "late-ack",
				identity,
				agent: { id: "codex", label: "Codex" },
				kind: "mapping",
				state: "queued",
				phase: "queued",
				startedAt: null,
				updatedAt: null,
				attempt: 1,
				trigger: "manual",
				activity: [],
			},
		});
		expect((await mapping)?.job?.id).toBe("late-ack");
		expect(controller.getSnapshot().snapshot?.pathVersion).toBe(2);
		expect(controller.getSnapshot().pending).toBe(false);
	});
}
