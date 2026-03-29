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
import type { MergedTicketIssue, NormalizedStatusCategory } from "../../shared/tickets";
import { columnToJiraCategory, columnToLinearStateType } from "../../shared/tickets";
import type { StatusColumn } from "./useTicketsData";
import { trpc } from "../trpc/client";

export function useTicketDragDrop(columns: StatusColumn[]) {
	const utils = trpc.useUtils();

	// ── Sensors ──────────────────────────────────────────────────────────────
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
		useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
	);

	// ── Drag state ───────────────────────────────────────────────────────────
	const [activeIssue, setActiveIssue] = useState<MergedTicketIssue | null>(null);

	// ── Mutations (reuse existing) ───────────────────────────────────────────
	const updateJiraStatus = trpc.atlassian.updateIssueStatus.useMutation();
	const updateLinearState = trpc.linear.updateIssueState.useMutation();

	// Keep a ref to the pre-update query snapshots for rollback
	const snapshotRef = useRef<{
		jira: unknown;
		linear: unknown;
	} | null>(null);

	// ── Helpers ──────────────────────────────────────────────────────────────
	const findIssueAndColumn = useCallback(
		(issueId: string): { issue: MergedTicketIssue; column: NormalizedStatusCategory } | null => {
			for (const col of columns) {
				const issue = col.items.find(
					(i) => `${i.provider}:${i.id}` === issueId || i.id === issueId,
				);
				if (issue) return { issue, column: col.category };
			}
			return null;
		},
		[columns],
	);

	// ── Drag handlers ────────────────────────────────────────────────────────
	const handleDragStart = useCallback(
		(event: DragStartEvent) => {
			const result = findIssueAndColumn(String(event.active.id));
			if (result) setActiveIssue(result.issue);
		},
		[findIssueAndColumn],
	);

	const handleDragEnd = useCallback(
		async (event: DragEndEvent) => {
			const { active, over } = event;
			setActiveIssue(null);

			if (!over) return;

			const source = findIssueAndColumn(String(active.id));
			if (!source) return;

			// The droppable container ID is the column category
			const targetColumn = String(over.id) as NormalizedStatusCategory;

			// Could have dropped on another card — resolve to its column
			const targetFromCard = findIssueAndColumn(String(over.id));
			const resolvedTarget: NormalizedStatusCategory = targetFromCard
				? targetFromCard.column
				: targetColumn;

			if (source.column === resolvedTarget) return;

			const { issue } = source;

			// For Jira: bail out if source and target columns map to the same category
			// (e.g. backlog and todo both map to "new" in Jira)
			if (issue.provider === "jira") {
				const sourceCategory = columnToJiraCategory(source.column);
				const targetCategory = columnToJiraCategory(resolvedTarget);
				if (sourceCategory === targetCategory) return;
			}

			// ── Optimistic update ────────────────────────────────────────────
			snapshotRef.current = {
				jira: utils.atlassian.getMyIssues.getData(),
				linear: utils.linear.getAssignedIssues.getData(),
			};

			if (issue.provider === "jira") {
				utils.atlassian.getMyIssues.setData(undefined, (old) => {
					if (!old) return old;
					return old.map((i) =>
						i.key === issue.id
							? { ...i, statusCategory: columnToJiraCategory(resolvedTarget) }
							: i,
					);
				});
			} else {
				utils.linear.getAssignedIssues.setData(undefined, (old) => {
					if (!old) return old;
					return old.map((i) =>
						i.id === issue.id
							? { ...i, stateType: columnToLinearStateType(resolvedTarget) as any }
							: i,
					);
				});
			}

			// ── Resolve transition/state and fire mutation ───────────────────
			try {
				if (issue.provider === "jira") {
					const transitions = await utils.atlassian.getIssueTransitions.fetch({
						issueKey: issue.id,
					});
					const targetCategoryKey = columnToJiraCategory(resolvedTarget);
					const transition = transitions.find((t) => t.categoryKey === targetCategoryKey);
					if (!transition) throw new Error("No matching Jira transition available");
					await updateJiraStatus.mutateAsync({
						issueKey: issue.id,
						transitionId: transition.id,
					});
				} else {
					const states = await utils.linear.getTeamStates.fetch({
						teamId: issue.groupId,
					});
					const targetStateType = columnToLinearStateType(resolvedTarget);
					const state = states.find((s) => s.type === targetStateType);
					if (!state) throw new Error("No matching Linear state available");
					await updateLinearState.mutateAsync({
						issueId: issue.id,
						stateId: state.id,
					});
				}
			} catch {
				// ── Rollback ─────────────────────────────────────────────────
				if (snapshotRef.current) {
					if (issue.provider === "jira" && snapshotRef.current.jira) {
						utils.atlassian.getMyIssues.setData(
							undefined,
							snapshotRef.current.jira as ReturnType<typeof utils.atlassian.getMyIssues.getData>,
						);
					} else if (snapshotRef.current.linear) {
						utils.linear.getAssignedIssues.setData(
							undefined,
							snapshotRef.current.linear as ReturnType<
								typeof utils.linear.getAssignedIssues.getData
							>,
						);
					}
				}
			} finally {
				snapshotRef.current = null;
				// Sync with server
				utils.atlassian.getMyIssues.invalidate();
				utils.linear.getAssignedIssues.invalidate();
			}
		},
		[findIssueAndColumn, utils, updateJiraStatus, updateLinearState],
	);

	return {
		sensors,
		activeIssue,
		collisionDetection: closestCenter,
		handleDragStart,
		handleDragEnd,
	};
}
