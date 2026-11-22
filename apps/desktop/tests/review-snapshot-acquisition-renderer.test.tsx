import { expect, test } from "bun:test";
import { StrictMode, act } from "react";
import type { PRContext } from "../src/shared/github-types";
import { inIsolatedFileBrowserTest } from "./helpers/isolated-file-browser-test";

if (inIsolatedFileBrowserTest(import.meta.path, "snapshot acquisition hook lifecycle")) {
	const { renderBrowserTest } = await import("./helpers/file-browser-renderer");
	const { useReviewSnapshot } = await import(
		"../src/renderer/components/review-mode/step/useReviewSnapshot"
	);
	const { resetReviewSnapshotAcquisition } = await import(
		"../src/renderer/lib/snapshot-acquisition"
	);
	const ctx: PRContext = {
		provider: "bitbucket",
		owner: "org",
		repo: "repo",
		number: 1,
		title: "PR",
		sourceBranch: "feature",
		targetBranch: "main",
		repoPath: "/unused",
	};
	const missing =
		"Review commit objects are unavailable locally. Acquire the revision before retrying";
	let observed: ReturnType<typeof useReviewSnapshot>;
	function Probe({ workspace }: { workspace: string }) {
		observed = useReviewSnapshot(workspace, ctx, "b".repeat(40), "a".repeat(40));
		return (
			<output data-pending={observed.isPending} data-error={observed.isError}>
				{observed.snapshot?.headOid}
			</output>
		);
	}

	test.each([false, true])(
		"StrictMode acquisition completes without stuck pending (read failure=%s)",
		async (readFailure) => {
			let reads = 0;
			let acquisitions = 0;
			const h = await renderBrowserTest(
				<StrictMode>
					<Probe workspace={`strict-${readFailure}`} />
				</StrictMode>,
				[],
				false,
				{
					request: (path) => {
						if (path === "reviewExplanation.resolveSnapshot") {
							reads++;
							if (reads === 1) throw Error(missing);
							if (readFailure)
								throw Error(
									"Complete local history is required to establish the review merge base"
								);
							return { headOid: "a".repeat(40), files: [] };
						}
						if (path === "reviewExplanation.acquireSnapshotRevisions") {
							acquisitions++;
							return { acquired: true };
						}
						throw Error(path);
					},
				}
			);
			try {
				for (let i = 0; i < 10; i++) await h.settle();
				expect(acquisitions).toBe(1);
				expect(reads).toBe(2);
				expect(observed.isPending).toBe(false);
				expect(observed.isError).toBe(readFailure);
				if (!readFailure) expect(observed.snapshot?.headOid).toBe("a".repeat(40));
			} finally {
				await h.cleanup();
			}
		}
	);

	test("failed acquisition survives remount without retry until this workspace is explicitly refreshed", async () => {
		let acquisitions = 0;
		const h = await renderBrowserTest(<Probe workspace="failed" />, [], false, {
			request: (path) => {
				if (path === "reviewExplanation.resolveSnapshot") throw Error(missing);
				if (path === "reviewExplanation.acquireSnapshotRevisions") {
					acquisitions++;
					throw Error("Review revision fetch failed. Check Git authentication.");
				}
				throw Error(path);
			},
		});
		try {
			for (let i = 0; i < 5; i++) await h.settle();
			expect(acquisitions).toBe(1);
			await h.rerender(<div />);
			await h.rerender(<Probe workspace="failed" />);
			for (let i = 0; i < 5; i++) await h.settle();
			expect(acquisitions).toBe(1);
			expect(observed.isPending).toBe(false);
			expect(observed.isError).toBe(true);
			await act(async () => resetReviewSnapshotAcquisition("unrelated"));
			for (let i = 0; i < 3; i++) await h.settle();
			expect(acquisitions).toBe(1);
			await act(async () => resetReviewSnapshotAcquisition("failed"));
			for (let i = 0; i < 5; i++) await h.settle();
			expect(acquisitions).toBe(2);
		} finally {
			await h.cleanup();
		}
	});

	test("remount during acquisition attaches to the same attempt and finishes loading", async () => {
		let acquisitions = 0;
		let ready = false;
		let finish!: () => void;
		const pending = new Promise<void>((resolve) => {
			finish = resolve;
		});
		const h = await renderBrowserTest(<Probe workspace="inflight" />, [], false, {
			request: async (path) => {
				if (path === "reviewExplanation.resolveSnapshot") {
					if (!ready) throw Error(missing);
					return { headOid: "a".repeat(40), files: [] };
				}
				if (path === "reviewExplanation.acquireSnapshotRevisions") {
					acquisitions++;
					await pending;
					ready = true;
					return { acquired: true };
				}
				throw Error(path);
			},
		});
		try {
			for (let i = 0; i < 5; i++) await h.settle();
			expect(acquisitions).toBe(1);
			await h.rerender(<div />);
			await h.rerender(
				<StrictMode>
					<Probe workspace="inflight" />
				</StrictMode>
			);
			await act(async () => {
				finish();
			});
			for (let i = 0; i < 10; i++) await h.settle();
			expect(acquisitions).toBe(1);
			expect(observed.isPending).toBe(false);
			expect(observed.isError).toBe(false);
			expect(observed.snapshot?.headOid).toBe("a".repeat(40));
		} finally {
			finish();
			await h.cleanup();
		}
	});
}
