import { expect, test } from "bun:test";
import { act } from "react";
import type { GitHubPRDetails, PRContext } from "../src/shared/github-types";
import type { ReviewSnapshot } from "../src/shared/review-snapshot-types";
import { inIsolatedFileBrowserTest } from "./helpers/isolated-file-browser-test";

if (inIsolatedFileBrowserTest(import.meta.path, "explicit PR refresh retries snapshot content")) {
	const { renderBrowserTest } = await import("./helpers/file-browser-renderer");
	const { useReviewWorkspaceData } = await import(
		"../src/renderer/components/review-mode/useReviewWorkspaceData"
	);
	const { useStepContent } = await import(
		"../src/renderer/components/review-mode/step/useStepContent"
	);
	const { useContextContent } = await import(
		"../src/renderer/components/review-mode/step/useContextContent"
	);
	const ctx: PRContext = {
		provider: "github",
		owner: "org",
		repo: "repo",
		number: 1,
		title: "Refresh review",
		sourceBranch: "change",
		targetBranch: "main",
		repoPath: "/repo",
	};
	const details: GitHubPRDetails = {
		title: ctx.title,
		body: "",
		state: "OPEN",
		isDraft: false,
		author: "review-author",
		authorAvatarUrl: "",
		reviewDecision: null,
		ciState: null,
		checks: [],
		reviewers: [],
		reviewThreads: [],
		conversationComments: [],
		files: [{ path: "file.ts", additions: 1, deletions: 1, changeType: "MODIFIED" }],
		sourceBranch: "change",
		targetBranch: "main",
		headCommitOid: "a".repeat(40),
		baseCommitOid: "b".repeat(40),
	};
	const snapshot = (workspaceId: string): ReviewSnapshot => ({
		version: 1,
		id: "c".repeat(64),
		workspaceId,
		repositoryKey: "repo",
		targetTipOid: "b".repeat(40),
		headOid: "a".repeat(40),
		mergeBaseOid: "b".repeat(40),
		renameDetection: "bounded",
		files: [
			{
				id: "d".repeat(64),
				path: "file.ts",
				status: "modified",
				base: { path: "file.ts", oid: "e".repeat(40), mode: "100644" },
				head: { path: "file.ts", oid: "f".repeat(40), mode: "100644" },
			},
		],
	});
	function Content({ workspaceId }: { workspaceId: string }) {
		const file = useStepContent(workspaceId, ctx, details, "file.ts");
		const context = useContextContent(
			workspaceId,
			ctx,
			"context.ts",
			details.baseCommitOid,
			details.headCommitOid
		);
		return (
			<section data-workspace={workspaceId}>
				<output data-file>{file.unavailable ? "unavailable" : file.modifiedContent}</output>
				<output data-context>{context.message ?? context.content}</output>
			</section>
		);
	}
	function Harness() {
		const data = useReviewWorkspaceData("refresh-workspace", ctx);
		return (
			<>
				<button type="button" onClick={() => data.refreshDetails()}>
					Refresh
				</button>
				<Content workspaceId="refresh-workspace" />
				<Content workspaceId="other-workspace" />
			</>
		);
	}
	test.each([false, true])(
		"Refresh retries scoped content only after snapshot recreation (metadata fails=%s)",
		async (metadataFails) => {
			let release: (() => void) | undefined;
			const blocked = new Promise<void>((resolve) => {
				release = resolve;
			});
			let recreated = false;
			const reads: string[] = [];
			const metadataReads = new Map<string, number>();
			const h = await renderBrowserTest(<Harness />, [], false, {
				request: async (path, value) => {
					if (path === "projects.getPRDetails") return details;
					if (path === "reviewPath.status") return null;
					if (path === "reviewExplanation.resolveSnapshot") {
						const { workspaceId } = value as { workspaceId: string };
						const count = (metadataReads.get(workspaceId) ?? 0) + 1;
						metadataReads.set(workspaceId, count);
						if (workspaceId === "refresh-workspace" && count > 1) {
							await blocked;
							if (metadataFails) throw new Error("Review snapshot is unavailable");
							recreated = true;
						}
						return snapshot(workspaceId);
					}
					if (
						path === "reviewExplanation.getSnapshotFile" ||
						path === "reviewExplanation.getSnapshotContext"
					) {
						const input = value as { workspaceId: string; side: string };
						reads.push(`${input.workspaceId}:${path}:${input.side}`);
						if (input.workspaceId !== "refresh-workspace" || !recreated)
							throw new Error("Review snapshot is no longer cached");
						return {
							kind: "text",
							path: path.endsWith("Context") ? "context.ts" : "file.ts",
							blobOid: "e".repeat(40),
							content: path.endsWith("Context") ? "context recovered" : `${input.side} recovered`,
						};
					}
					return [];
				},
			});
			try {
				await h.settle();
				const section = h.container.querySelector('[data-workspace="refresh-workspace"]');
				expect(section?.querySelector("[data-file]")?.textContent).toBe("unavailable");
				expect(section?.querySelector("[data-context]")?.textContent).toContain("no longer cached");
				const initialReads = reads.length;
				expect(initialReads).toBe(6);
				await act(async () => h.container.querySelector("button")?.click());
				await h.settle();
				expect(metadataReads.get("refresh-workspace")).toBe(2);
				expect(reads).toHaveLength(initialReads);
				await act(async () => {
					release?.();
				});
				await h.settle();
				await h.settle();
				if (metadataFails) {
					expect(section?.querySelector("[data-file]")?.textContent).toBe("unavailable");
					expect(reads).toHaveLength(initialReads);
					expect(metadataReads.get("refresh-workspace")).toBe(2);
					return;
				}
				expect(section?.querySelector("[data-file]")?.textContent).toBe("head recovered");
				expect(section?.querySelector("[data-context]")?.textContent).toBe("context recovered");
				expect(reads.filter((read) => read.startsWith("other-workspace:"))).toHaveLength(3);
				expect(reads.filter((read) => read.startsWith("refresh-workspace:"))).toHaveLength(6);
				expect(metadataReads.get("other-workspace")).toBe(1);
			} finally {
				release?.();
				await h.cleanup();
			}
		}
	);
}
