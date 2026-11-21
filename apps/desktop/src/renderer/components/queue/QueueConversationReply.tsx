import { useEffect, useId, useRef, useState } from "react";
import type {
	WorkspaceQueueItem,
	WorkspaceQueueReplyCapability,
	WorkspaceQueueReplyInput,
	WorkspaceQueueReplyResult,
	WorkspaceQueueRevisionInput,
} from "../../../shared/activity-queue";
export interface QueueConversationActions {
	receipt?: (requestId: string) => Promise<WorkspaceQueueReplyResult | null>;
	capability: (input: WorkspaceQueueRevisionInput) => Promise<WorkspaceQueueReplyCapability>;
	reply: (input: WorkspaceQueueReplyInput) => Promise<WorkspaceQueueReplyResult>;
}
const receipt = (item: WorkspaceQueueItem): WorkspaceQueueRevisionInput => ({
	id: item.id,
	revision: item.revision,
	members: item.members?.map((m) => ({ id: m.id, revision: m.revision })),
});
interface Draft {
	content: string;
	receipt: WorkspaceQueueRevisionInput;
	target: string;
	requestId?: string;
	result?: WorkspaceQueueReplyResult;
}
export function QueueConversationReply({
	item,
	available,
	actions,
	refresh,
}: {
	item: WorkspaceQueueItem;
	available: boolean;
	actions?: QueueConversationActions;
	refresh: () => Promise<unknown>;
}) {
	const [drafts, setDrafts] = useState<Record<string, Draft>>({});
	const capabilityKey = JSON.stringify([receipt(item), item.target]);
	const [capabilityResult, setCapabilityResult] = useState<{
		key: string;
		value: WorkspaceQueueReplyCapability;
	}>();
	const capability = capabilityResult?.key === capabilityKey ? capabilityResult.value : undefined;
	const [busy, setBusy] = useState(false);
	const running = useRef(false);
	const inputId = useId();

	useEffect(() => {
		let active = true;
		setCapabilityResult(undefined);
		if (actions && !item.question && ["agent-done", "agent-failed"].includes(item.situation))
			actions
				.capability(receipt(item))
				.then((value) => {
					if (active) setCapabilityResult({ key: capabilityKey, value });
				})
				.catch(() => {
					if (active)
						setCapabilityResult({
							key: capabilityKey,
							value: {
								status: "unavailable",
								reason: "Reply availability could not be checked. Open the conversation.",
							},
						});
				});
		return () => {
			active = false;
		};
	}, [actions, item, capabilityKey]);
	const draft = drafts[item.id] ?? {
		content: "",
		receipt: receipt(item),
		target: JSON.stringify(item.target),
	};
	useEffect(() => {
		if (!draft.requestId || !actions?.receipt || draft.result?.status === "received") return;
		const requestId = draft.requestId;
		let active = true;
		const refreshReceipt = () => {
			void actions
				.receipt?.(requestId)
				.then((result) => {
					if (active && result)
						setDrafts((all) =>
							all[item.id]?.requestId === requestId &&
							!(all[item.id]?.result?.status === "received" && result.status !== "received")
								? {
										...all,
										[item.id]: {
											...all[item.id]!,
											result,
											requestId: result.status === "rejected" ? undefined : requestId,
										},
									}
								: all
						);
				})
				.catch(() => {});
		};
		refreshReceipt();
		const timer = setInterval(refreshReceipt, 1000);
		return () => {
			active = false;
			clearInterval(timer);
		};
	}, [actions, draft.requestId, draft.result?.status, item.id]);
	if (item.question || !["agent-done", "agent-failed"].includes(item.situation) || !actions)
		return null;
	const changed =
		JSON.stringify(draft.receipt) !== JSON.stringify(receipt(item)) ||
		draft.target !== JSON.stringify(item.target);
	const update = (patch: Partial<Draft>) =>
		setDrafts((all) => {
			const previous = all[item.id] ?? draft;
			const next = { ...previous, ...patch };
			if (
				patch.requestId &&
				previous.requestId === patch.requestId &&
				previous.result?.status === "received" &&
				patch.result?.status !== "received"
			)
				next.result = previous.result;
			return { ...all, [item.id]: next };
		});
	const locked = !!draft.requestId;
	const send = async () => {
		if (
			running.current ||
			!actions ||
			changed ||
			!draft.content.trim() ||
			(!locked && (!available || capability?.status !== "available"))
		)
			return;
		running.current = true;
		setBusy(true);
		const requestId = draft.requestId ?? crypto.randomUUID();
		update({ requestId });
		let result: WorkspaceQueueReplyResult;
		try {
			result = locked
				? ((await actions.receipt?.(requestId)) ?? {
						status: "uncertain",
						requestId,
						detail:
							"No delivery receipt is available. Open the chat to check before sending again.",
					})
				: await actions.reply({ ...draft.receipt, requestId, content: draft.content });
		} catch {
			result = {
				status: "uncertain",
				requestId,
				detail:
					"Delivery is uncertain. Check delivery with the same request, or open the chat. Do not resend.",
			};
		}
		update({
			requestId:
				result.status === "admitted" ||
				result.status === "uncertain" ||
				result.status === "received"
					? requestId
					: undefined,
			result,
		});
		try {
			await refresh();
		} catch {}
		running.current = false;
		setBusy(false);
	};
	return (
		<section aria-label="Reply to conversation" className="my-4 space-y-2">
			<label className="block text-[12px]" htmlFor={`queue-reply-${inputId}`}>
				Reply to {item.context.terminalTitle ?? item.context.workspaceName}
			</label>
			<textarea
				id={`queue-reply-${inputId}`}
				value={draft.content}
				disabled={busy || locked}
				onChange={(e) => update({ content: e.target.value })}
				className="w-full rounded border border-[var(--border)] bg-[var(--bg-elevated)] p-3 text-[12px]"
				rows={3}
			/>
			{changed && (
				<div>
					<p role="alert">
						This occurrence changed. Your draft is preserved; review the current update before
						replying.
					</p>
					<button
						type="button"
						disabled={busy}
						onClick={() =>
							update({
								content: "",
								receipt: receipt(item),
								target: JSON.stringify(item.target),
								requestId: undefined,
								result: undefined,
							})
						}
					>
						Start reply to current update
					</button>
				</div>
			)}
			<p className="text-[11px] text-[var(--text-tertiary)]">
				{capability?.status === "unavailable"
					? capability.reason
					: (capability?.detail ?? "Checking safe reply availability…")}
			</p>
			{draft.result && (
				<output className="block text-[12px]">
					{"detail" in draft.result ? draft.result.detail : draft.result.reason}
				</output>
			)}
			<button
				type="button"
				disabled={
					busy ||
					changed ||
					!draft.content.trim() ||
					(locked
						? draft.result?.status !== "uncertain" || !actions.receipt
						: !available || capability?.status !== "available")
				}
				onClick={() => void send()}
				className="rounded border border-[var(--border)] px-3 py-2 text-[12px] disabled:opacity-40"
			>
				{busy ? "Submitting…" : locked ? "Check delivery" : "Send reply"}
			</button>
		</section>
	);
}
