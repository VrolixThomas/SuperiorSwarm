import { useEffect, useRef, useState } from "react";
import type { ExternalQueueItem } from "../../../shared/activity-queue";
import { openOwnedChat } from "../../lib/owned-chat-launch";
import { useTabStore } from "../../stores/tab-store";
import { trpc, trpcVanilla } from "../../trpc/client";
import { queueButton } from "./QueuePanel";
export function QueuePRActions({
	item,
	refresh,
}: { item: ExternalQueueItem; refresh: () => Promise<unknown> }) {
	const query = trpc.activityQueue.prReviewCapability.useQuery(
		{ id: item.id, revision: item.revision },
		{ enabled: item.kind === "pr-review" && !item.stale, retry: false, staleTime: 0 }
	);
	const [pending, setPending] = useState<{ requestId: string; notBefore: number } | null>(null);
	const [message, setMessage] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const mounted = useRef(true);
	const operation = useRef<string | null>(null);
	const dispatchStarted = useRef<string | null>(null);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
			const requestId = operation.current;
			if (requestId) void trpcVanilla.activityQueue.prReviewCancel.mutate({ requestId });
		};
	}, []);
	useEffect(() => {
		if (!pending || dispatchStarted.current === pending.requestId) return;
		const timer = setTimeout(
			async () => {
				if (!mounted.current || dispatchStarted.current === pending.requestId) return;
				dispatchStarted.current = pending.requestId;
				setBusy(true);
				try {
					const result = await trpcVanilla.activityQueue.prReviewDispatch.mutate({
						requestId: pending.requestId,
					});
					if (mounted.current) {
						setMessage(result.detail ?? result.status);
						setPending(null);
					}
					await refresh();
				} catch {
					if (mounted.current)
						setMessage(
							"Submission status is unavailable. Inspect the provider before any new approval; this request will not be retried."
						);
				} finally {
					operation.current = null;
					if (mounted.current) setBusy(false);
				}
			},
			Math.max(0, pending.notBefore - Date.now())
		);
		return () => clearTimeout(timer);
	}, [pending, refresh]);
	const prepare = async (approveAnyway: boolean) => {
		if (!query.data || busy || operation.current) return;
		setBusy(true);
		setMessage(null);
		const requestId = crypto.randomUUID();
		operation.current = requestId;
		try {
			const receipt = await trpcVanilla.activityQueue.prReviewPrepare.mutate({
				id: item.id,
				revision: item.revision,
				requestId,
				headSha: query.data.headSha,
				approveAnyway,
			});
			if (!mounted.current) {
				await trpcVanilla.activityQueue.prReviewCancel.mutate({ requestId });
				return;
			}
			setPending(receipt);
		} catch (e) {
			operation.current = null;
			if (mounted.current)
				setMessage(e instanceof Error ? e.message : "Approval could not be prepared.");
		} finally {
			if (mounted.current) setBusy(false);
		}
	};
	if (item.kind === "pr-feedback")
		return (
			<section aria-label="Solve PR feedback" className="my-4 space-y-2 text-[12px]">
				<button
					type="button"
					className={queueButton}
					disabled={busy || item.stale || !item.context.workspaceId}
					onClick={async () => {
						setBusy(true);
						setMessage(null);
						try {
							const result = await trpcVanilla.activityQueue.prSolveFeedback.mutate({
								id: item.id,
								revision: item.revision,
							});
							if (result.status === "prepared") {
								await openOwnedChat(result.launch, {
									activateWorkspace: (id, cwd) =>
										useTabStore.getState().setActiveWorkspace(id, cwd),
									addTerminal: (id, cwd, title, terminalId) =>
										useTabStore.getState().addTerminalTab(id, cwd, title, terminalId),
									createTerminal: (id, cwd, owner) =>
										window.electron.terminal.create(id, cwd, owner),
									writeTerminal: (id, text) => window.electron.terminal.write(id, text),
								});
								useTabStore
									.getState()
									.addSolveReviewTab(result.launch.workspaceId, result.sessionId, { split: true });
							} else setMessage("Solver launch canceled.");
						} catch (error) {
							setMessage(
								error instanceof Error
									? error.message
									: "Solver launch failed. Feedback remains pending."
							);
						} finally {
							setBusy(false);
						}
					}}
				>
					Solve feedback in linked workspace
				</button>
				{item.missingContext && <p>{item.missingContext}</p>}
				{message && <output>{message}</output>}
			</section>
		);
	if (item.kind !== "pr-review") return null;
	return (
		<section aria-label="PR review action" className="my-4 space-y-2 text-[12px]">
			<h3 className="font-medium">Review evidence</h3>
			{item.stale && (
				<p>
					Provider status is unavailable. Open the review to inspect it; queue approval waits for a
					successful refresh.
				</p>
			)}
			{query.isLoading && <p>Checking your review, changed files, threads and CI…</p>}
			{query.error && <p>Review evidence is unavailable. Open the review to inspect it.</p>}
			{query.data?.evidence.map((line) => (
				<p key={line} className="break-words text-[var(--text-secondary)]">
					{line}
				</p>
			))}
			{query.data?.reasons.map((line) => (
				<p key={line} className="text-[var(--text-tertiary)]">
					{line}
				</p>
			))}
			{pending ? (
				<div>
					<p>Approval waits five seconds. Undo or leave this view to cancel before dispatch.</p>
					<button
						type="button"
						className={queueButton}
						disabled={busy}
						onClick={async () => {
							const id = pending.requestId;
							setPending(null);
							operation.current = null;
							const result = await trpcVanilla.activityQueue.prReviewCancel.mutate({
								requestId: id,
							});
							setMessage(
								result?.status === "cancelled"
									? "Approval canceled. Nothing was submitted."
									: "Dispatch may have started. Check the provider."
							);
						}}
					>
						Undo approval
					</button>
				</div>
			) : (
				query.data && (
					<button
						type="button"
						className={`${queueButton} border border-[var(--border)]`}
						disabled={busy || item.stale}
						data-queue-pr-approve={query.data.eligible ? "eligible" : undefined}
						onClick={() => void prepare(!query.data.eligible)}
					>
						{query.data.eligible
							? "Approve reviewed changes"
							: "Approve anyway after inspecting changes"}
					</button>
				)
			)}
			{message && <output className="block">{message}</output>}
		</section>
	);
}
