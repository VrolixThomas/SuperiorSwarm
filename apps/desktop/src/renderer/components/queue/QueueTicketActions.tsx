import { useState } from "react";
import type { ExternalQueueItem } from "../../../shared/activity-queue";
import type { TicketQueueAccount } from "../../../shared/ticket-queue";
import type { TicketIssue } from "../../../shared/tickets";
import { openTicketQueueTarget } from "../../stores/queue-ticket-store";
import { trpc } from "../../trpc/client";
import { CreateBranchFromIssueModal } from "../CreateBranchFromIssueModal";

export function QueueTicketActions({
	item,
	refresh,
}: { item: ExternalQueueItem; refresh: () => Promise<unknown> }) {
	const prepare = trpc.activityQueue.ticketPrepare.useMutation();
	const [start, setStart] = useState<{
		issue: TicketIssue;
		account: TicketQueueAccount;
		defaultAgent: "claude" | "codex";
		id: string;
		revision: number;
	} | null>(null);
	const [error, setError] = useState<string | null>(null);
	const act = async (action: "open" | "start") => {
		setError(null);
		try {
			const result = await prepare.mutateAsync({ id: item.id, revision: item.revision, action });
			if (action === "open") openTicketQueueTarget(item.id, result.target);
			else
				setStart({
					issue: result.issue,
					account: result.target,
					defaultAgent: result.settings.defaultAgent,
					id: item.id,
					revision: item.revision,
				});
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Could not open this ticket.");
			await refresh();
		}
	};
	return (
		<div className="flex flex-col gap-3">
			<button
				type="button"
				disabled={prepare.isPending}
				onClick={() => void act("open")}
				className="rounded-lg border border-[var(--border)] px-4 py-2 text-left"
			>
				Open ticket
			</button>
			{item.kind === "ticket-start" && (
				<button
					type="button"
					disabled={prepare.isPending || item.stale}
					onClick={() => void act("start")}
					data-queue-ticket-start
					className="rounded-lg bg-[var(--accent)] px-4 py-2 text-[var(--accent-foreground)]"
				>
					Start work…
				</button>
			)}
			{error && <p role="alert">{error}</p>}
			{start && (
				<CreateBranchFromIssueModal
					issue={start.issue}
					queueStart={start}
					onClose={() => {
						setStart(null);
						void refresh();
					}}
				/>
			)}
		</div>
	);
}

export function QueueTicketSettings({ refresh }: { refresh: () => Promise<unknown> }) {
	const settings = trpc.activityQueue.ticketSettings.useQuery();
	const update = trpc.activityQueue.ticketSetSettings.useMutation({
		onSuccess: async () => {
			await settings.refetch();
			await refresh();
		},
	});
	const current = settings.data;
	if (!current) return null;
	return (
		<fieldset className="flex flex-wrap items-center gap-3 text-sm" disabled={update.isPending}>
			<label className="flex items-center gap-2">
				<input
					type="checkbox"
					checked={current.showAll}
					onChange={(event) => update.mutate({ ...current, showAll: event.target.checked })}
				/>
				Show all my unstarted tickets
			</label>
			<label className="flex items-center gap-2">
				Start tickets with{" "}
				<select
					value={current.defaultAgent}
					onChange={(event) =>
						update.mutate({
							...current,
							defaultAgent: event.target.value === "claude" ? "claude" : "codex",
						})
					}
				>
					<option value="codex">Codex</option>
					<option value="claude">Claude</option>
				</select>
			</label>
			{update.error && <p role="alert">{update.error.message}</p>}
		</fieldset>
	);
}
