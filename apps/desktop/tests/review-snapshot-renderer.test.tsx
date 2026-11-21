import { expect, mock, test } from "bun:test";
import { rmSync } from "node:fs";
import { act } from "react";
import { ReviewSnapshotService } from "../src/main/review-explanation/snapshot";
import { createReviewExplanationRouter } from "../src/main/trpc/routers/review-explanation";
import type { GitHubPRDetails, PRContext } from "../src/shared/github-types";
import type { ReviewSnapshotContent } from "../src/shared/review-snapshot-types";
import { inIsolatedFileBrowserTest } from "./helpers/isolated-file-browser-test";
import { snapshotFixture } from "./helpers/review-snapshot-fixture";

if (
	inIsolatedFileBrowserTest(
		import.meta.path,
		"snapshot renderer through production tRPC and local Git"
	)
) {
	const { renderBrowserTest } = await import("./helpers/file-browser-renderer");
	mock.module("../src/renderer/components/review-mode/step/ContextEditor", () => ({
		ContextEditor: (p: { content: string }) => <div data-context>{p.content}</div>,
	}));
	const { useStepContent } = await import(
		"../src/renderer/components/review-mode/step/useStepContent"
	);
	const { ContextFileView } = await import(
		"../src/renderer/components/review-mode/step/ContextFileView"
	);
	const prCtx: PRContext = {
		provider: "github",
		owner: "org",
		repo: "repo",
		number: 1,
		title: "PR",
		sourceBranch: "change",
		targetBranch: "main",
		repoPath: "/unused",
	};
	const step = {
		id: "context",
		kind: "context" as const,
		path: "empty.txt",
		note: "",
		focus: [],
		addedBy: "agent" as const,
	};
	const setup = () => {
		const fixture = snapshotFixture();
		const service = new ReviewSnapshotService({
			resolveRoot: async (id) => {
				if (id !== "registered") throw new Error("unknown workspace");
				return fixture.root;
			},
		});
		const api = createReviewExplanationRouter(service).createCaller({});
		const request = (path: string, input: unknown) => {
			if (path === "reviewExplanation.resolveSnapshot")
				return api.resolveSnapshot(input as Parameters<typeof api.resolveSnapshot>[0]);
			if (path === "reviewExplanation.getSnapshotFile")
				return api.getSnapshotFile(input as Parameters<typeof api.getSnapshotFile>[0]);
			if (path === "reviewExplanation.getSnapshotContext")
				return api.getSnapshotContext(input as Parameters<typeof api.getSnapshotContext>[0]);
			throw new Error(`Forbidden RPC ${path}`);
		};
		const details = {
			headCommitOid: fixture.head,
			baseCommitOid: fixture.target,
		} as GitHubPRDetails;
		return { fixture, request, details };
	};
	function Subject({
		details,
		path,
		ctx = prCtx,
		workspaceId = "registered",
	}: { details: GitHubPRDetails; path: string; ctx?: PRContext; workspaceId?: string }) {
		const state = useStepContent(workspaceId, ctx, details, path);
		return (
			<output
				data-loading={state.isLoading}
				data-unavailable={state.unavailable}
				data-original={state.originalContent}
				data-modified={state.modifiedContent}
			>
				{state.contentMessage}
			</output>
		);
	}
	async function until(h: Awaited<ReturnType<typeof renderBrowserTest>>, predicate: () => boolean) {
		for (let i = 0; i < 100 && !predicate(); i++) await h.settle();
		expect(predicate()).toBe(true);
	}
	test("changed reads are pinned across mutable branch/worktree changes and revision switches", async () => {
		const { fixture, request, details } = setup();
		fixture.git("update-ref", "refs/heads/change", fixture.base);
		fixture.write("new.txt", "mutable sentinel");
		const h = await renderBrowserTest(<Subject details={details} path="new.txt" />, [], false, {
			request,
		});
		try {
			await until(
				h,
				() => h.container.querySelector("output")?.dataset["modified"] === "head only\n"
			);
			expect(h.container.querySelector("output")?.dataset["original"]).toBe("");
			await h.rerender(
				<Subject details={{ ...details, headCommitOid: fixture.base }} path="new.txt" />
			);
			expect(h.container.querySelector("output")?.dataset["modified"]).toBe("");
			await until(h, () => h.container.textContent?.includes("not part of this snapshot") === true);
			expect(h.calls.every((c) => c.path.startsWith("reviewExplanation."))).toBe(true);
		} finally {
			await h.cleanup();
			rmSync(fixture.directory, { recursive: true, force: true });
		}
	});
	test("unknown revisions never fall back to branch reads", async () => {
		const { fixture, request, details } = setup();
		const h = await renderBrowserTest(
			<Subject details={{ ...details, baseCommitOid: undefined }} path="new.txt" />,
			[],
			false,
			{ request }
		);
		try {
			expect(h.calls).toEqual([]);
			expect(h.container.textContent).toContain("Refresh");
			expect(h.container.querySelector("output")?.dataset["unavailable"]).toBe("true");
		} finally {
			await h.cleanup();
			rmSync(fixture.directory, { recursive: true, force: true });
		}
	});
	test("context distinguishes empty/missing/binary and never issues viewed or mutation calls", async () => {
		const { fixture, request, details } = setup();
		fixture.git("checkout", "change");
		fixture.write("binary", Buffer.from([0, 1]));
		details.headCommitOid = fixture.commit();
		const view = (path: string) => (
			<ContextFileView
				workspaceId="registered"
				prCtx={prCtx}
				baseRef={details.baseCommitOid}
				headRef={details.headCommitOid}
				step={{ ...step, path }}
			/>
		);
		const h = await renderBrowserTest(view("empty.txt"), [], false, { request });
		try {
			await until(
				h,
				() => h.container.textContent?.includes("File is empty at this revision") === true
			);
			await h.rerender(view("missing"));
			await until(h, () => h.container.textContent?.includes("does not exist") === true);
			await h.rerender(view("binary"));
			await until(h, () => h.container.textContent?.includes("Binary file") === true);
			expect(h.container.querySelector('input[type="checkbox"]')).toBeNull();
			expect(
				h.calls.every(
					(c) =>
						c.path === "reviewExplanation.resolveSnapshot" ||
						c.path === "reviewExplanation.getSnapshotContext"
				)
			).toBe(true);
		} finally {
			await h.cleanup();
			rmSync(fixture.directory, { recursive: true, force: true });
		}
	});
	test("provider, PR and workspace switches cannot reuse another review query", async () => {
		const { fixture, request, details } = setup();
		const h = await renderBrowserTest(<Subject details={details} path="new.txt" />, [], false, {
			request,
		});
		try {
			await until(
				h,
				() => h.container.querySelector("output")?.dataset["modified"] === "head only\n"
			);
			for (const ctx of [
				{ ...prCtx, provider: "bitbucket" as const },
				{ ...prCtx, number: 2 },
				{ ...prCtx, owner: "other" },
				{ ...prCtx, repo: "other" },
			]) {
				const before = h.calls.filter((c) => c.path === "reviewExplanation.resolveSnapshot").length;
				await h.rerender(<Subject details={details} path="new.txt" ctx={ctx} />);
				await until(
					h,
					() =>
						h.calls.filter((c) => c.path === "reviewExplanation.resolveSnapshot").length > before
				);
			}
			await h.rerender(<Subject details={details} path="new.txt" workspaceId="foreign" />);
			await until(h, () => h.container.querySelector("output")?.dataset["unavailable"] === "true");
			expect(h.container.querySelector("output")?.dataset["modified"]).toBe("");
		} finally {
			await h.cleanup();
			rmSync(fixture.directory, { recursive: true, force: true });
		}
	});
	test("late context results cannot display old content under the new path", async () => {
		const { fixture, request, details } = setup();
		let finish: ((value: ReviewSnapshotContent) => void) | undefined;
		const view = (path: string) => (
			<ContextFileView
				workspaceId="registered"
				prCtx={prCtx}
				baseRef={details.baseCommitOid}
				headRef={details.headCommitOid}
				step={{ ...step, path }}
			/>
		);
		const h = await renderBrowserTest(view("new.txt"), [], false, {
			request: (path, input) =>
				path === "reviewExplanation.getSnapshotContext" &&
				(input as { path: string }).path === "new.txt"
					? new Promise<ReviewSnapshotContent>((resolve) => {
							finish = resolve;
						})
					: request(path, input),
		});
		try {
			await until(h, () => !!finish);
			await h.rerender(view("renamed.ts"));
			await until(h, () => h.container.textContent?.includes("export const first") === true);
			await act(async () =>
				finish?.({
					kind: "text",
					content: "wrong late content",
					path: "new.txt",
					blobOid: "a".repeat(40),
				})
			);
			expect(h.container.textContent).not.toContain("wrong late content");
		} finally {
			await h.cleanup();
			rmSync(fixture.directory, { recursive: true, force: true });
		}
	});
}
