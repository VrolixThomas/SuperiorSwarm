import { expect, test } from "bun:test";
import { act } from "react";
import type { PRContext } from "../src/shared/github-types";
import type { ReviewPathIdentity, ReviewPathSnapshot } from "../src/shared/review-path-runtime";
import { inIsolatedFileBrowserTest } from "./helpers/isolated-file-browser-test";
if (
	inIsolatedFileBrowserTest(import.meta.path, "F4 Ask acknowledgement and per-launch hook delivery")
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
	test("overlapping Map and Ask invoke both owned launch callbacks once", async () => {
		const attached: string[] = [];
		const releases = new Map<string, (result: unknown) => void>();
		function Harness() {
			const onLaunch = (launch: { terminalId?: string }) => {
				if (launch.terminalId) attached.push(launch.terminalId);
			};
			const path = useReviewPath(pr, { headCommitOid: identity.headSha }, { identity, onLaunch });
			const ask = useAskAgent(pr, { identity, onLaunch });
			return (
				<button
					type="button"
					onClick={() => {
						path.start({ agentId: "codex", alsoReview: false });
						void ask.send("Why?");
					}}
				>
					Launch both
				</button>
			);
		}
		const h = await renderBrowserTest(<Harness />, [], false, {
			request: (path) => {
				if (path === "reviewPath.get") return snapshot(identity);
				if (path === "reviewPath.start" || path === "reviewPath.ask")
					return new Promise((resolve) => releases.set(path, resolve));
				if (path.includes("Settings"))
					return { autoMapOnReviewRequest: false, alsoReview: false, defaultRailMode: "auto" };
				throw Error(path);
			},
		});
		try {
			await act(async () => h.container.querySelector("button")?.click());
			await h.settle();
			await act(async () =>
				releases.get("reviewPath.ask")?.({
					snapshot: { ...snapshot(identity), pathVersion: 2 },
					launch: { terminalId: "ask-owned" },
				})
			);
			await act(async () =>
				releases.get("reviewPath.start")?.({
					snapshot: { ...snapshot(identity), pathVersion: 1 },
					launch: { terminalId: "map-owned" },
				})
			);
			await h.settle();
			expect(attached).toEqual(["ask-owned", "map-owned"]);
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
				if (path === "reviewPath.ask") throw Error("pre-persistence rejection");
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
			const attempts = h.calls.filter((call) => call.path === "reviewPath.ask");
			expect(attempts).toHaveLength(2);
			expect((attempts[0]?.input as { id: string }).id).toBe(
				(attempts[1]?.input as { id: string }).id
			);
			await h.rerender(<Harness identity={{ ...current, headSha: "b".repeat(40) }} />);
			expect(h.container.textContent).not.toContain("pre-persistence rejection");
		} finally {
			await h.cleanup();
		}
	});
}
