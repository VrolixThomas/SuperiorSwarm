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
	const key = JSON.stringify([item.id, item.revision, item.members, item.target, item.permission]);
	const [refreshVersion, setRefreshVersion] = useState(0);
	const [result, setResult] = useState<{ key: string; value: QueuePermissionCapability }>();
	const capability: QueuePermissionCapability =
		result?.key === key
			? result.value
			: { capability: "unavailable", detail: "Checking this request…" };
	useEffect(() => {
		let active = true;
		let version = refreshVersion;
		const check = () => {
			if (!actions || !item.permission) return;
			const requestVersion = ++version;
			void actions
				.capability({ id: item.id, revision: item.revision, members: item.members })
				.then((value) => {
					if (active && requestVersion === version) setResult({ key, value });
				})
				.catch(() => {
					if (active && requestVersion === version)
						setResult({
							key,
							value: {
								capability: "unavailable",
								detail: "Open the conversation to check this request.",
							},
						});
				});
		};
		check();
		const timer = setInterval(check, 1000);
		return () => {
			active = false;
			clearInterval(timer);
		};
	}, [actions, item, key, refreshVersion]);
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
				setRefreshVersion((value) => value + 1);
				void refresh().catch(() => {});
			}}
		/>
	);
}
