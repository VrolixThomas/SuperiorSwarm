import { expect, test } from "bun:test";
import { act } from "react";
import type { ReviewPathTransport } from "../src/renderer/lib/review-path-source";
import type { ReviewPathIdentity, ReviewPathSnapshot } from "../src/shared/review-path-runtime";
import { inIsolatedFileBrowserTest } from "./helpers/isolated-file-browser-test";

if (inIsolatedFileBrowserTest(import.meta.path, "manual draft acknowledgement ordering")) {
	const { renderBrowserTest } = await import("./helpers/file-browser-renderer");
	const {
		observeReviewMapping,
		reviewDraftBindingVersion,
		setReviewDraftBinding,
		useReviewDraftBinding,
	} = await import("../src/renderer/lib/review-draft-binding");
	const identity = (workspaceId: string): ReviewPathIdentity => ({
		workspaceId,
		provider: "github",
		owner: "o",
		repo: "r",
		prNumber: 1,
		headSha: "a".repeat(40),
	});
	for (const initial of [undefined, "mapping-A"]) {
		test(`late acknowledgement from ${initial ?? "unmapped"} cannot override mapping B`, async () => {
			const scope = identity(`delivery-${initial ?? "unmapped"}`);
			let observed: ReturnType<typeof useReviewDraftBinding>;
			function Probe() {
				observed = useReviewDraftBinding(scope);
				return null;
			}
			observeReviewMapping(scope, initial);
			const initiatingVersion = reviewDraftBindingVersion(scope);
			const h = await renderBrowserTest(<Probe />, [], false);
			try {
				await act(async () => {
					observeReviewMapping(scope, "mapping-B");
					setReviewDraftBinding(scope, "draft-B", reviewDraftBindingVersion(scope));
				});
				await h.settle();
				expect(observed?.draftId).toBe("draft-B");
				await act(async () => {
					expect(setReviewDraftBinding(scope, "late-draft-A", initiatingVersion)).toBe(false);
				});
				await h.settle();
				expect(observed?.draftId).toBe("draft-B");
			} finally {
				await h.cleanup();
			}
		});
	}

	test("current acknowledgement remains accepted across repeated observations and another scope's remap", async () => {
		const scope = identity("delivery-current");
		const other = identity("delivery-other");
		let observed: ReturnType<typeof useReviewDraftBinding>;
		function Probe() {
			observed = useReviewDraftBinding(scope);
			return null;
		}
		observeReviewMapping(scope, "mapping-current");
		const initiatingVersion = reviewDraftBindingVersion(scope);
		const h = await renderBrowserTest(<Probe />, [], false);
		try {
			await act(async () => {
				observeReviewMapping(scope, "mapping-current");
				observeReviewMapping(other, "mapping-other");
				observeReviewMapping(other, "mapping-other-next");
				expect(reviewDraftBindingVersion(scope)).toBe(initiatingVersion);
				expect(setReviewDraftBinding(scope, "manual-current", initiatingVersion)).toBe(true);
			});
			await h.settle();
			expect(observed?.draftId).toBe("manual-current");
		} finally {
			await h.cleanup();
		}
	});

	test("controller publication fences old acknowledgements before subscriber callbacks and renderer effects", async () => {
		const { createLiveReviewPathController } = await import(
			"../src/renderer/lib/review-path-source"
		);
		const scope = identity("delivery-controller");
		const snapshot = (id: string, version: number): ReviewPathSnapshot => ({
			identity: scope,
			path: null,
			pathVersion: version,
			conversationId: id,
			questions: [],
			messages: [],
			runs: [
				{
					identity: scope,
					id,
					version,
					kind: "mapping",
					state: "running",
					conversationId: id,
					reviewDraftId: `draft-${id}`,
				},
			],
		});
		let incoming = snapshot("A", 1);
		const unused = async (): Promise<never> => {
			throw new Error("Unexpected mutation");
		};
		const transport: ReviewPathTransport = {
			get: async () => incoming,
			start: unused,
			ask: unused,
			cancel: unused,
			cancelQuestion: unused,
			addContext: unused,
			removeContext: unused,
		};
		const controller = createLiveReviewPathController(scope, transport);
		await controller.refresh();
		const initiatingVersion = reviewDraftBindingVersion(scope);
		setReviewDraftBinding(scope, "draft-A", initiatingVersion);
		const accepted: boolean[] = [];
		const unsubscribe = controller.subscribe(() => {
			accepted.push(setReviewDraftBinding(scope, "late-draft-A", initiatingVersion));
		});
		try {
			incoming = snapshot("B", 2);
			await controller.refresh();
			expect(accepted).toEqual([false]);
			expect(reviewDraftBindingVersion(scope)).toBeGreaterThan(initiatingVersion);
			expect(setReviewDraftBinding(scope, "draft-B", reviewDraftBindingVersion(scope))).toBe(true);
		} finally {
			unsubscribe();
		}
	});
}
