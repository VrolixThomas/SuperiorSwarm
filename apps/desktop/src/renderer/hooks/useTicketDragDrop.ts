import {
	type DragEndEvent,
	type DragStartEvent,
	KeyboardSensor,
	PointerSensor,
	closestCenter,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useCallback, useRef, useState } from "react";
import type { MergedTicketIssue } from "../../shared/tickets";
import { columnToJiraCategory, columnToLinearStateType } from "../../shared/tickets";
import { trpc } from "../trpc/client";
import type { StatusColumn } from "./useTicketsData";

interface StatusMutations {
	updateJiraStatus: ReturnType<typeof trpc.atlassian.updateIssueStatus.useMutation>;
	updateLinearState: ReturnType<typeof trpc.linear.updateIssueState.useMutation>;
}

export function useTicketDragDrop(columns: StatusColumn[], mutations: StatusMutations) {
	const utils = trpc.useUtils();
	const { updateJiraStatus, updateLinearState } = mutations;

	// ── Sensors ──────────────────────────────────────────────────────────────
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
		useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
	);

	// ── Drag state ───────────────────────────────────────────────────────────
	const [activeIssue, setActiveIssue] = useState<MergedTicketIssue | null>(null);

	// Keep a ref to the pre-update query snapshots for rollback
	const snapshotRef = useRef<ReturnType<typeof utils.tickets.getCachedTickets.getData> | null>(
		null
	);

	// ── Helpers ──────────────────────────────────────────────────────────────
	const findIssueAndColumn = useCallback(
		(issueId: string): { issue: MergedTicketIssue; column: StatusColumn } | null => {
			for (const col of columns) {
				const issue = col.items.find(
					(i) => `${i.provider}:${i.id}` === issueId || i.id === issueId
				);
				if (issue) return { issue, column: col };
			}
			return null;
		},
		[columns]
	);

	// ── Drag handlers ────────────────────────────────────────────────────────
	const handleDragStart = useCallback(
		(event: DragStartEvent) => {
			const result = findIssueAndColumn(String(event.active.id));
			if (result) setActiveIssue(result.issue);
		},
		[findIssueAndColumn]
	);

	const handleDragEnd = useCallback(
		async (event: DragEndEvent) => {
			const { active, over } = event;
			setActiveIssue(null);

			if (!over) return;

			const source = findIssueAndColumn(String(active.id));
			if (!source) return;

			// Could have dropped on another card — resolve to its column
			const targetFromCard = findIssueAndColumn(String(over.id));
			const resolvedTarget =
				targetFromCard?.column ?? columns.find((column) => column.id === String(over.id));
			if (!resolvedTarget) return;

			if (source.column.id === resolvedTarget.id) return;

			const { issue } = source;

			// Generic Jira views still use broad categories. A configured Jira board
			// has exact status IDs and may contain several columns in one category.
			if (issue.provider === "jira" && !resolvedTarget.jiraStatusIds) {
				const sourceCategory = columnToJiraCategory(source.column.category);
				const targetCategory = columnToJiraCategory(resolvedTarget.category);
				if (sourceCategory === targetCategory) return;
			}

			// ── Resolve transition/state and fire mutation ───────────────────
			try {
				if (issue.provider === "jira") {
					const transitions = await utils.atlassian.getIssueTransitions.fetch({
						issueKey: issue.id,
					});
					const targetCategoryKey = columnToJiraCategory(resolvedTarget.category);
					const transition = resolvedTarget.jiraStatusIds
						? transitions.find(
								(candidate) =>
									candidate.targetStatusId !== undefined &&
									resolvedTarget.jiraStatusIds?.includes(candidate.targetStatusId)
							)
						: transitions.find((candidate) => candidate.categoryKey === targetCategoryKey);
					if (!transition) throw new Error("No matching Jira transition available");

					snapshotRef.current = utils.tickets.getCachedTickets.getData();
					utils.tickets.getCachedTickets.setData(undefined, (old) => {
						if (!old) return old;
						return {
							...old,
							jiraIssues: old.jiraIssues.map((candidate) =>
								candidate.key === issue.id
									? {
											...candidate,
											statusId: transition.targetStatusId ?? candidate.statusId,
											status: transition.targetStatusName ?? transition.name,
											statusCategory: transition.categoryKey ?? targetCategoryKey,
											statusColor: transition.color,
										}
									: candidate
							),
						};
					});
					await updateJiraStatus.mutateAsync({
						issueKey: issue.id,
						transitionId: transition.id,
					});
				} else {
					const states = await utils.linear.getTeamStates.fetch({
						teamId: issue.groupId,
					});
					const targetStateType = columnToLinearStateType(resolvedTarget.category);
					const state = states.find((s) => s.type === targetStateType);
					if (!state) throw new Error("No matching Linear state available");

					snapshotRef.current = utils.tickets.getCachedTickets.getData();
					utils.tickets.getCachedTickets.setData(undefined, (old) => {
						if (!old) return old;
						return {
							...old,
							linearIssues: old.linearIssues.map((candidate) =>
								candidate.id === issue.id ? { ...candidate, stateType: targetStateType } : candidate
							),
						};
					});
					await updateLinearState.mutateAsync({
						issueId: issue.id,
						stateId: state.id,
					});
				}
			} catch {
				// ── Rollback ─────────────────────────────────────────────────
				if (snapshotRef.current) {
					utils.tickets.getCachedTickets.setData(undefined, snapshotRef.current);
				}
			} finally {
				snapshotRef.current = null;
			}
		},
		[columns, findIssueAndColumn, utils, updateJiraStatus, updateLinearState]
	);

	const handleDragCancel = useCallback(() => {
		setActiveIssue(null);
	}, []);

	return {
		sensors,
		activeIssue,
		collisionDetection: closestCenter,
		handleDragStart,
		handleDragEnd,
		handleDragCancel,
	};
}
