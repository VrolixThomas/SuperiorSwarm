import { useEffect, useState } from "react";
import type {
	WorkspaceQueueItem,
	WorkspaceQueueRevisionInput,
} from "../../../shared/activity-queue";
import type {
	QueuePermissionCapability,
	QueuePermissionDecisionInput,
	QueuePermissionDecisionResult,
} from "../../../shared/queue-permissions";
import { QueuePermissionDecision } from "./QueuePermissionDecision";
export interface QueuePermissionActionsAPI {
	capability: (input: WorkspaceQueueRevisionInput) => Promise<QueuePermissionCapability>;
	decide: (input: QueuePermissionDecisionInput) => Promise<QueuePermissionDecisionResult>;
}
export function QueuePermissionActions({
	item,
	available,
	actions,
	onOpen,
	refresh,
}: {
	item: WorkspaceQueueItem;
	available: boolean;
	actions?: QueuePermissionActionsAPI;
	onOpen: () => void;
	refresh: () => Promise<unknown>;
}) {
	const [capability, setCapability] = useState<QueuePermissionCapability>({
		capability: "unavailable",
		detail: "Checking this request…",
	});
	useEffect(() => {
		let active = true;
		if (actions && item.permission)
			actions
				.capability({ id: item.id, revision: item.revision, members: item.members })
				.then((value) => {
					if (active) setCapability(value);
				})
				.catch(() => {
					if (active)
						setCapability({
							capability: "unavailable",
							detail: "Open the conversation to check this request.",
						});
				});
		return () => {
			active = false;
		};
	}, [actions, item]);
	if (!item.permission || !actions) return null;
	return (
		<QueuePermissionDecision
			item={item}
			capability={
				available
					? capability
					: {
							capability: "unavailable",
							detail: "Refresh the queue before responding to this request.",
						}
			}
			onDecide={actions.decide}
			onOpen={onOpen}
			onChanged={() => {
				void refresh().catch(() => {});
			}}
		/>
	);
}
