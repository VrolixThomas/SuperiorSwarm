import { expect, test } from "bun:test";
import { act } from "react";
import type { PRContext } from "../src/shared/github-types";
import type { ReviewAgentJob } from "../src/shared/review-agent-job";
import type { ReviewPathIdentity, ReviewPathSnapshot } from "../src/shared/review-path-runtime";
import { inIsolatedFileBrowserTest } from "./helpers/isolated-file-browser-test";
if (
	inIsolatedFileBrowserTest(import.meta.path, "F4 Ask acknowledgement and durable job delivery")
) {
	const { renderBrowserTest } = await import("./helpers/file-browser-renderer");
	const { useReviewPath } = await import("../src/renderer/lib/review-path-source");
	const { useAskAgent } = await import("../src/renderer/components/review-mode/panel/useAskAgent");
	const { AskTab } = await import("../src/renderer/components/review-mode/panel/AskTab");
	const pr: PRContext = {
		provider: "github",
		owner: "o",
		repo: "r",
		number: 1,
		title: "PR",
		sourceBranch: "change",
		targetBranch: "main",
		repoPath: "/isolated",
	};
	const identity: ReviewPathIdentity = {
		workspaceId: "f4-hooks",
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
		runs: [],
		questions: [],
		messages: [],
	});
	test("overlapping Map and Ask acknowledge durable background tabs without launching a PTY", async () => {
		const { useTabStore } = await import("../src/renderer/stores/tab-store");
		const { usePaneStore } = await import("../src/renderer/stores/pane-store");
		const { observeReviewAgentJob } = await import("../src/renderer/lib/review-agent-jobs");
		usePaneStore.setState({ layouts: {}, focusedPaneId: null });
		useTabStore.setState({
			workspaceMetadata: {},
			activeWorkspaceId: null,
			activeWorkspaceCwd: "",
		});
		const tabs = useTabStore.getState();
		tabs.ensureReviewTab(identity.workspaceId, pr);
		tabs.setActiveWorkspace(identity.workspaceId, pr.repoPath);
		const focused = usePaneStore.getState().focusedPaneId;
		const selected = tabs.getActiveTabId();
		const callbacks: string[] = [];
		let created = 0;
		let acknowledged = false;
		const releases = new Map<string, (result: unknown) => void>();
		const makeJob = (id: string, kind: ReviewAgentJob["kind"]): ReviewAgentJob => ({
			id,
			identity,
			agent: { id: "codex", label: "Codex" },
			kind,
			state: "queued",
			phase: "queued",
			startedAt: "2026-11-22T12:00:00Z",
			updatedAt: "2026-11-22T12:00:00Z",
			attempt: 1,
			trigger: "manual",
			activity: [],
		});
		function Harness() {
			const onLaunch = (launch: { terminalId?: string }) => {
				if (launch.terminalId) callbacks.push(launch.terminalId);
			};
			const path = useReviewPath(pr, { headCommitOid: identity.headSha }, { identity, onLaunch });
			const ask = useAskAgent(pr, { identity, onLaunch });
			return (
				<button
					type="button"
					onClick={() => {
						path.start({ agentId: "codex", alsoReview: false });
						void ask.send("Why?").then((ok) => {
							acknowledged = ok;
						});
					}}
				>
					Launch both
				</button>
			);
		}
		const h = await renderBrowserTest(<Harness />, [], false, {
			electron: {
				terminal: {
					create: () => {
						created++;
					},
				},
			},
			request: (path) => {
				if (path === "reviewPath.get") return snapshot(identity);
				if (path === "reviewPath.jobs") return [];
				if (path === "reviewPath.startJob" || path === "reviewPath.askJob")
					return new Promise((resolve) => releases.set(path, resolve));
				if (path === "aiReview.getSettings") return { cliPreset: "codex" };
				if (path.includes("Settings"))
					return { autoMapOnReviewRequest: false, alsoReview: false, defaultRailMode: "auto" };
				throw Error(path);
			},
		});
		try {
			const readsBefore = h.calls.filter((call) => call.path === "reviewPath.get").length;
			await act(async () => h.container.querySelector("button")?.click());
			await h.settle();
			expect(releases.size).toBe(2);
			const askJob = makeJob("f4-ask-job", "question");
			const mapJob = makeJob("f4-map-job", "mapping");
			await act(async () => releases.get("reviewPath.askJob")?.(askJob));
			await h.settle();
			expect(acknowledged).toBe(true);
			expect(
				tabs.getTabsByWorkspace(identity.workspaceId).filter((t) => t.kind === "review-agent")
			).toHaveLength(1);
			await act(async () => releases.get("reviewPath.startJob")?.(mapJob));
			await h.settle();
			expect(h.calls.filter((call) => call.path === "reviewPath.get")).toHaveLength(readsBefore);
			expect(
				tabs
					.getTabsByWorkspace(identity.workspaceId)
					.filter((t) => t.kind === "review-agent")
					.map((t) => t.jobId)
					.sort()
			).toEqual(["f4-ask-job", "f4-map-job"]);
			expect(tabs.getActiveTabId()).toBe(selected);
			expect(usePaneStore.getState().focusedPaneId).toBe(focused);
			// Repeated polling attaches metadata to the same tab; it never creates a PTY.
			for (const job of [askJob, mapJob]) {
				const running = {
					...job,
					state: "running" as const,
					terminalId: `review-path:${job.id}:1`,
					cwd: "/isolated",
				};
				observeReviewAgentJob(running);
				observeReviewAgentJob(running);
			}
			expect(
				tabs.getTabsByWorkspace(identity.workspaceId).filter((t) => t.kind === "review-agent")
			).toHaveLength(2);
			expect(created).toBe(0);
			expect(callbacks).toEqual([]);
			expect(
				h.calls.some((call) => call.path === "reviewPath.start" || call.path === "reviewPath.ask")
			).toBe(false);
		} finally {
			await h.cleanup();
		}
	});
	test("composer keeps rejected draft through offline refetch and waits for ack without duplicate retries", async () => {
		let release: ((ok: boolean) => void) | undefined;
		let calls = 0;
		const props = {
			messages: [],
			available: true,
			initialQuestion: "Keep this question",
			onReference: () => {},
			onSend: () => {
				calls++;
				return new Promise<boolean>((r) => {
					release = r;
				});
			},
		};
		const h = await renderBrowserTest(<AskTab {...props} />);
		const send = () =>
			h.container.querySelector<HTMLButtonElement>('button[aria-label="Send question"]');
		const draft = () => h.container.querySelector("textarea")?.value;
		try {
			await act(async () => {
				send()?.click();
				send()?.click();
			});
			expect(calls).toBe(1);
			expect(draft()).toBe("Keep this question");
			await act(async () => release?.(false));
			expect(draft()).toBe("Keep this question");
			await h.rerender(<AskTab {...props} available={false} error="offline" />);
			expect(draft()).toBe("Keep this question");
			await h.rerender(<AskTab {...props} />);
			await act(async () => {
				send()?.click();
				send()?.click();
			});
			expect(calls).toBe(2);
			await act(async () => release?.(true));
			expect(draft()).toBe("");
		} finally {
			await h.cleanup();
		}
	});
	test("failed Ask remains scoped to its identity after polls and changed head", async () => {
		function Harness({ identity }: { identity: ReviewPathIdentity }) {
			const ask = useAskAgent(pr, { identity });
			return (
				<>
					<button type="button" onClick={() => void ask.send("Retain me")}>
						Ask
					</button>
					<output>{ask.error}</output>
				</>
			);
		}
		const current = { ...identity, workspaceId: "f4-error" };
		const h = await renderBrowserTest(<Harness identity={current} />, [], false, {
			request: (path, input) => {
				if (path === "reviewPath.get")
					return snapshot((input as { identity: ReviewPathIdentity }).identity);
				if (path === "reviewPath.askJob") throw Error("pre-persistence rejection");
				if (path === "reviewPath.jobs") return [];
				if (path === "aiReview.getSettings") return { cliPreset: "codex" };
				throw Error(path);
			},
		});
		try {
			await act(async () => h.container.querySelector("button")?.click());
			await h.settle();
			expect(h.container.textContent).toContain("pre-persistence rejection");
			await act(async () => {
				await new Promise((r) => setTimeout(r, 1600));
			});
			expect(h.container.textContent).toContain("pre-persistence rejection");
			await act(async () => h.container.querySelector("button")?.click());
			await h.settle();
			const attempts = h.calls.filter((call) => call.path === "reviewPath.askJob");
			expect(attempts).toHaveLength(2);
			expect((attempts[0]?.input as { requestId: string }).requestId).toBe(
				(attempts[1]?.input as { requestId: string }).requestId
			);
			await h.rerender(<Harness identity={{ ...current, headSha: "b".repeat(40) }} />);
			expect(h.container.textContent).not.toContain("pre-persistence rejection");
		} finally {
			await h.cleanup();
		}
	});
}
