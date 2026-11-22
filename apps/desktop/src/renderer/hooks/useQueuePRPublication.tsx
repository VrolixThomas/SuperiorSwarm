import { useCallback, useEffect, useRef, useState } from "react";
import type { PRContext } from "../../shared/github-types";
import type { QueuePROrigin, QueuePRPublication } from "../../shared/queue-pr-publication";
import { usePaneStore } from "../stores/pane-store";
import { useReviewModeStore } from "../stores/review-mode-store";
import { useTabStore } from "../stores/tab-store";
import { trpcVanilla } from "../trpc/client";
export function useQueuePRPublication(
	prCtx: PRContext | undefined,
	headSha: string | undefined,
	binding?: { origin: QueuePROrigin; workspaceId: string } | null
) {
	const reviewOrigin = useReviewModeStore((s) => s.queueOrigin);
	const origin = binding ? { ...binding.origin, workspaceId: binding.workspaceId } : reviewOrigin;
	const active = useReviewModeStore((s) => s.active);
	const view = useReviewModeStore((s) => s.view);
	const segment = useTabStore((s) => s.sidebarSegment);
	const workspace = useTabStore((s) => s.activeWorkspaceId);
	const applicable =
		!!binding ||
		(!!prCtx &&
			!!origin &&
			active?.workspaceId === origin.workspaceId &&
			active.prCtx.provider === prCtx.provider &&
			active.prCtx.owner === prCtx.owner &&
			active.prCtx.repo === prCtx.repo &&
			active.prCtx.number === prCtx.number);
	const [pending, setPending] = useState(false);
	const [dispatching, setDispatching] = useState(false);
	const operation = useRef<{
		id: string;
		timer?: ReturnType<typeof setTimeout>;
		reject: (error: Error) => void;
		dispatched: boolean;
	} | null>(null);
	const mounted = useRef(true);
	const cancel = useCallback(() => {
		const current = operation.current;
		if (!current || current.dispatched) return;
		operation.current = null;
		clearTimeout(current.timer);
		void trpcVanilla.activityQueue.prPublicationCancel
			.mutate({ requestId: current.id })
			.catch(() => {});
		current.reject(new Error("Publication canceled. Your draft is retained."));
		if (mounted.current) {
			setPending(false);
			setDispatching(false);
		}
	}, []);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
			cancel();
		};
	}, [cancel]);
	const paneTab = usePaneStore((s) =>
		workspace ? s.getFocusedPane(workspace)?.activeTabId : null
	);
	const identity = JSON.stringify([origin, view, segment, workspace, paneTab]);
	const previousIdentity = useRef(identity);
	useEffect(() => {
		if (previousIdentity.current !== identity) cancel();
		previousIdentity.current = identity;
	}, [cancel, identity]);
	const submit = useCallback(
		async (payload: QueuePRPublication) => {
			if (!applicable || !origin || !headSha)
				throw new Error("Refresh the queue review before publishing.");
			if (operation.current) throw new Error("A publication is already pending.");
			const requestId = crypto.randomUUID();
			return await new Promise<
				Awaited<ReturnType<typeof trpcVanilla.activityQueue.prPublicationDispatch.mutate>>
			>((resolve, reject) => {
				const current = {
					id: requestId,
					reject,
					dispatched: false,
					timer: undefined as ReturnType<typeof setTimeout> | undefined,
				};
				operation.current = current;
				setPending(true);
				void trpcVanilla.activityQueue.prPublicationPrepare
					.mutate({
						origin: { id: origin.id, revision: origin.revision },
						requestId,
						headSha,
						operation: payload,
					})
					.then((receipt) => {
						if (!mounted.current || operation.current !== current) {
							void trpcVanilla.activityQueue.prPublicationCancel
								.mutate({ requestId })
								.catch(() => {});
							return;
						}
						if (receipt.status !== "pending")
							throw new Error(receipt.detail ?? "Publication is no longer pending.");
						current.timer = setTimeout(
							async () => {
								if (!mounted.current || operation.current !== current) return;
								current.dispatched = true;
								setDispatching(true);
								try {
									const result = await trpcVanilla.activityQueue.prPublicationDispatch.mutate({
										requestId,
									});
									if (result.status !== "submitted")
										throw new Error(
											result.detail ??
												"Publication did not complete; inspect the provider before retrying."
										);
									resolve(result);
								} catch (error) {
									reject(
										error instanceof Error ? error : new Error("Publication status is unknown.")
									);
								} finally {
									operation.current = null;
									if (mounted.current) {
										setPending(false);
										setDispatching(false);
									}
								}
							},
							Math.max(0, receipt.notBefore - Date.now())
						);
					})
					.catch((error) => {
						if (operation.current === current) {
							operation.current = null;
							if (mounted.current) {
								setPending(false);
								setDispatching(false);
							}
						}
						reject(
							error instanceof Error ? error : new Error("Publication could not be prepared.")
						);
					});
			});
		},
		[applicable, origin, headSha]
	);
	const notice = pending ? (
		<output className="border border-[var(--border)] p-2 text-[12px]">
			{dispatching
				? "Publishing…"
				: "Publication waits five seconds. Leaving this view cancels before dispatch."}
			<button type="button" disabled={dispatching} onClick={cancel} className="ml-2 underline">
				Undo publication
			</button>
		</output>
	) : null;
	return { applicable, submit, notice, cancel, pending };
}
