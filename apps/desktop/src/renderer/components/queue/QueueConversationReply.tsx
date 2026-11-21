import { useEffect, useRef, useState } from "react";
import type {
	WorkspaceQueueItem,
	WorkspaceQueueReplyCapability,
	WorkspaceQueueReplyInput,
	WorkspaceQueueReplyResult,
	WorkspaceQueueRevisionInput,
} from "../../../shared/activity-queue";
export interface QueueConversationActions {
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
	const [capability, setCapability] = useState<WorkspaceQueueReplyCapability>();
	const [busy, setBusy] = useState(false);
	const running = useRef(false);

	useEffect(() => {
		let active = true;
		setCapability(undefined);
		if (actions && !item.question && ["agent-done", "agent-failed"].includes(item.situation))
			actions
				.capability(receipt(item))
				.then((value) => {
					if (active) setCapability(value);
				})
				.catch(() => {
					if (active)
						setCapability({
							status: "unavailable",
							reason: "Reply availability could not be checked. Open the conversation.",
						});
				});
		return () => {
			active = false;
		};
	}, [actions, item]);
	if (item.question || !["agent-done", "agent-failed"].includes(item.situation) || !actions)
		return null;
	const draft = drafts[item.id] ?? {
		content: "",
		receipt: receipt(item),
		target: JSON.stringify(item.target),
	};
	const changed =
		JSON.stringify(draft.receipt) !== JSON.stringify(receipt(item)) ||
		draft.target !== JSON.stringify(item.target);
	const update = (patch: Partial<Draft>) =>
		setDrafts((all) => ({ ...all, [item.id]: { ...draft, ...patch } }));
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
			result = await actions.reply({ ...draft.receipt, requestId, content: draft.content });
		} catch {
			result = {
				status: "uncertain",
				requestId,
				detail:
					"Delivery is uncertain. Check delivery with the same request, or open the chat. Do not resend.",
			};
		}
		update({ requestId, result });
		try {
			await refresh();
		} catch {}
		running.current = false;
		setBusy(false);
	};
	return (
		<section aria-label="Reply to conversation" className="my-4 space-y-2">
			<label className="block text-[12px]" htmlFor={`queue-reply-${item.id}`}>
				Reply to {item.context.terminalTitle ?? item.context.workspaceName}
			</label>
			<textarea
				id={`queue-reply-${item.id}`}
				value={draft.content}
				disabled={busy || locked}
				onChange={(e) => update({ content: e.target.value })}
				className="w-full rounded border border-[var(--border)] bg-[var(--bg-elevated)] p-3 text-[12px]"
				rows={3}
			/>
			{changed && (
				<p role="alert">
					This occurrence changed. Your draft is preserved; open the chat before replying.
				</p>
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
						? draft.result?.status !== "uncertain"
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
