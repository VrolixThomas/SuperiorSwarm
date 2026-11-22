import { useState } from "react";
import type { ExternalQueueItem } from "../../../shared/activity-queue";
import { trpc } from "../../trpc/client";

export function QueueHookActions({
	item,
	refresh,
}: { item: ExternalQueueItem; refresh: () => Promise<unknown> }) {
	const [workspaceId, setWorkspaceId] = useState("");
	const [message, setMessage] = useState<string | null>(null);
	const receipt = { id: item.id, revision: item.revision };
	const targets = trpc.queueHooks.fixTargets.useQuery(receipt, {
		enabled: item.target.type === "project-hook" && Boolean(item.target.fixPrompt),
	});
	const fix = trpc.queueHooks.fix.useMutation({
		onSuccess: (result) => {
			setMessage(
				result.status === "started"
					? "Agent started. This item stays until a successful check resolves it or you mark it Done."
					: "Launch cancelled."
			);
			void refresh().catch(() => {});
		},
		onError: () => {
			setMessage("The check or workspace changed, or launch failed. Refresh before retrying.");
			void refresh().catch(() => {});
		},
	});
	if (item.target.type !== "project-hook" || !item.target.fixPrompt) return null;
	const selected =
		targets.data?.find((target) => target.id === workspaceId)?.id ??
		(targets.data?.length === 1 ? targets.data[0]?.id : "");
	return (
		<div className="space-y-2 text-sm">
			<p>Fix with your configured default agent. Review the prompt and confirm the launch.</p>
			<details>
				<summary className="cursor-pointer">Suggested fix prompt</summary>
				<pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words text-xs">
					{item.target.fixPrompt}
				</pre>
			</details>
			<label className="block">
				Workspace in this project's root
				<select
					data-queue-hook-workspace
					aria-label="Fix workspace"
					value={selected}
					onChange={(event) => setWorkspaceId(event.target.value)}
					disabled={fix.isPending}
					className="mt-1 block w-full rounded border border-[var(--border)] bg-[var(--bg-elevated)] p-2"
				>
					<option value="">Choose a workspace</option>
					{targets.data?.map((target) => (
						<option key={target.id} value={target.id}>
							{target.name}
						</option>
					))}
				</select>
			</label>
			{targets.data?.length === 0 && (
				<p className="text-xs">
					Open or create a workspace in this project's root, and ensure its hook configuration is
					trusted.
				</p>
			)}
			<button
				type="button"
				data-queue-hook-fix
				disabled={!selected || item.stale || fix.isPending}
				onClick={() => selected && fix.mutate({ ...receipt, workspaceId: selected })}
				className="rounded border border-[var(--border)] px-3 py-2"
			>
				{fix.isPending ? "Awaiting launch…" : "Fix with agent…"}
			</button>
			{message && <output>{message}</output>}
		</div>
	);
}
