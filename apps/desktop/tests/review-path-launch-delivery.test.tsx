import { expect, test } from "bun:test";
import { act } from "react";
import type { PRContext } from "../src/shared/github-types";
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
		test(`${mode} late launch does not attach after switching head or unmounting`, async () => {
			const attached: string[] = [];
			let release: ((value: unknown) => void) | undefined;
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
			const h = await renderBrowserTest(<Harness current={identity} />, [], false, {
				request: (path, input) => {
					if (path === "reviewPath.get")
						return snapshot((input as { identity: ReviewPathIdentity }).identity);
					if (path === "reviewPath.start" || path === "reviewPath.ask")
						return new Promise((resolve) => {
							release = resolve;
						});
					if (path.includes("Settings"))
						return { autoMapOnReviewRequest: false, alsoReview: false, defaultRailMode: "auto" };
					throw Error(path);
				},
			});
			try {
				await h.settle();
				await act(async () => h.container.querySelector("button")?.click());
				await h.settle();
				const pending = release;
				if (!pending) throw Error("No pending launch");
				await h.rerender(<Harness current={{ ...identity, headSha: "b".repeat(40) }} />);
				await act(async () => {
					pending({ snapshot: snapshot(identity), launch: { terminalId: "old-owned" } });
				});
				await h.settle();
				expect(attached).toEqual([]);
				await act(async () => h.container.querySelector("button")?.click());
				await h.settle();
				const unmounted = release;
				await h.cleanup();
				unmounted?.({
					snapshot: snapshot({ ...identity, headSha: "b".repeat(40) }),
					launch: { terminalId: "unmounted-owned" },
				});
				await new Promise((resolve) => setTimeout(resolve, 0));
				expect(attached).toEqual([]);
			} finally {
				await h.cleanup();
			}
		});
}
