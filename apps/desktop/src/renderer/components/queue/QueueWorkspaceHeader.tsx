import type { QueueEntity } from "../../../shared/activity-queue";
import { trpc } from "../../trpc/client";
import { QueueLinkedWorkContext } from "./QueueLinkedWorkContext";
import { QueueWorkspacePending } from "./QueueWorkspacePending";

export function QueueWorkspaceHeader({
	entity,
	title,
	projectName,
}: { entity: QueueEntity; title: string; projectName?: string }) {
	const context = trpc.activityQueue.workspaceLinkedContext.useQuery(entity, {
		staleTime: 5_000,
		refetchInterval: 10_000,
	});
	return (
		<header
			data-queue-header
			className="app-drag flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--border-subtle)] px-3 py-1 text-[11px] text-[var(--text-secondary)]"
		>
			<span
				className="min-w-0 flex-1 truncate"
				title={[projectName, title].filter(Boolean).join(" › ")}
			>
				{projectName && <span className="text-[var(--text-tertiary)]">{projectName} › </span>}
				{title}
			</span>
			<div className="app-no-drag min-w-0">
				<QueueLinkedWorkContext items={context.data} compact />
			</div>
			<QueueWorkspacePending entity={entity} />
		</header>
	);
}
