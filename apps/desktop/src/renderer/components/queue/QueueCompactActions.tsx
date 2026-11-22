import { useId, useMemo, useRef, useState } from "react";
import type { QueueViewItem, WorkspaceQueueRevisionInput } from "../../../shared/activity-queue";
import { laterOptions } from "../../../shared/queue-later-options";
import { useQueueAnswerContinuationActions } from "../../hooks/useQueueAnswerContinuationActions";
import { trpc } from "../../trpc/client";
import { QueueHookActions } from "./QueueHookActions";
import { QueueItemActions } from "./QueueItemActions";
import { QueuePRActions } from "./QueuePRActions";
import { queueButton } from "./QueuePanel";
import type { QueueAnswerContinuationActions } from "./QueueQuestionReply";
import { QueueQuestionReply } from "./QueueQuestionReply";
import { QueueTicketActions } from "./QueueTicketActions";

/** Buttons only: a terminal keeps its own letter keys while the queue bar is visible. */
export function QueueCompactActions({
	item,
	disabled,
	refresh,
	onOpen,
	children,
	compact = false,
}: {
	item: QueueViewItem;
	disabled: boolean;
	refresh: () => Promise<unknown>;
	onOpen: () => void;
	children?: React.ReactNode;
	compact?: boolean;
}) {
	const done = trpc.activityQueue.viewDone.useMutation();
	const later = trpc.activityQueue.viewLater.useMutation();
	const undoDone = trpc.activityQueue.viewUndoDone.useMutation();
	const answer = trpc.activityQueue.workspaceAnswer.useMutation();
	const answerContinuationActions = useQueueAnswerContinuationActions();
	const lock = useRef(false);
	const answerInputId = useId();
	const [busy, setBusy] = useState(false);
	const [options, setOptions] = useState<ReturnType<typeof laterOptions>>([]);
	const [message, setMessage] = useState<string | null>(null);
	const [undo, setUndo] = useState<WorkspaceQueueRevisionInput | null>(null);
	const [expanded, setExpanded] = useState(!compact);
	const guardedAnswerContinuation = useMemo<QueueAnswerContinuationActions>(
		() => ({
			...answerContinuationActions,
			continue: async (input) => {
				if (lock.current)
					return {
						answer: null,
						continuation: { status: "unavailable", reason: "Another queue action is running." },
					};
				lock.current = true;
				setBusy(true);
				try {
					return await answerContinuationActions.continue(input);
				} finally {
					lock.current = false;
					setBusy(false);
				}
			},
		}),
		[answerContinuationActions]
	);
	const receipt = (): WorkspaceQueueRevisionInput => ({
		id: item.id,
		revision: item.revision,
		...(item.members ? { members: item.members } : {}),
	});
	const run = async (
		kind: "done" | "later" | "undo",
		option?: ReturnType<typeof laterOptions>[number]
	) => {
		if (lock.current || (kind !== "undo" && disabled)) return;
		lock.current = true;
		setBusy(true);
		setMessage(null);
		const exact = kind === "undo" ? undo : receipt();
		try {
			if (!exact) return;
			const result =
				kind === "done"
					? await done.mutateAsync(exact)
					: kind === "undo"
						? await undoDone.mutateAsync(exact)
						: await later.mutateAsync({
								...exact,
								until: option?.until,
								untilChange: option?.untilChange ?? false,
							});
			if (!["acknowledged", "restored", "snoozed"].includes(result.status))
				setMessage("This item changed. Select the latest activity before trying again.");
			else {
				setUndo(kind === "done" ? exact : null);
				setOptions([]);
				setMessage(
					kind === "done"
						? "Done — dismissed from queue"
						: kind === "undo"
							? "Restored"
							: "Moved to Later"
				);
			}
			await refresh();
		} catch (error) {
			setMessage(
				error instanceof Error ? error.message : "Action failed. Refresh before retrying."
			);
		} finally {
			lock.current = false;
			setBusy(false);
		}
	};
	return (
		<div data-queue-compact-actions className={compact ? "contents" : "min-w-0 space-y-2"}>
			{compact && (
				<button
					type="button"
					className={compact ? `${queueButton} !px-2 !py-1` : queueButton}
					aria-expanded={expanded}
					onClick={() => setExpanded(!expanded)}
				>
					Details / reply
				</button>
			)}
			<div
				hidden={!expanded}
				className={`${compact ? "order-2 w-full" : ""} max-h-[35vh] overflow-y-auto`}
			>
				{children}
				{item.category === "hooks" && (
					<QueueHookActions key={`${item.id}:${item.revision}`} item={item} refresh={refresh} />
				)}
				{item.category === "tickets" && (
					<QueueTicketActions key={`${item.id}:${item.revision}`} item={item} refresh={refresh} />
				)}
				{item.category === "prs" && (
					<QueuePRActions key={`${item.id}:${item.revision}`} item={item} refresh={refresh} />
				)}
				{item.category === "agents" && (
					<QueueItemActions
						item={item}
						disabled={disabled || busy}
						refresh={refresh}
						onOpen={onOpen}
					/>
				)}
				{item.category === "agents" && item.question && (
					<QueueQuestionReply
						inputId={answerInputId}
						continuationActions={guardedAnswerContinuation}
						item={item}
						available={!disabled && !busy}
						answer={async (input) => {
							if (lock.current)
								return { status: "unavailable", reason: "Another queue action is running." };
							lock.current = true;
							setBusy(true);
							try {
								return await answer.mutateAsync(input);
							} finally {
								lock.current = false;
								setBusy(false);
							}
						}}
						refresh={refresh}
					/>
				)}
			</div>
			<div className="flex shrink-0 flex-wrap items-center gap-1">
				<button
					type="button"
					className={compact ? `${queueButton} !px-2 !py-1` : queueButton}
					disabled={disabled || busy}
					onClick={onOpen}
					aria-label={compact ? "Open conversation" : "Open ↵"}
				>
					{compact ? "Open" : "Open ↵"}
				</button>
				<button
					type="button"
					data-queue-later
					aria-label={compact ? "Later" : "Later H"}
					className={compact ? `${queueButton} !px-2 !py-1` : queueButton}
					disabled={disabled || busy}
					onClick={() => setOptions(options.length ? [] : laterOptions(new Date()))}
				>
					{compact ? "Later" : "Later H"}
				</button>
				<button
					type="button"
					data-queue-done
					aria-label={compact ? "Done" : "Done E"}
					className={compact ? `${queueButton} !px-2 !py-1` : queueButton}
					disabled={disabled || busy}
					onClick={() => void run("done")}
				>
					{compact ? "Done" : "Done E"}
				</button>
				{undo && (
					<button
						type="button"
						data-queue-undo
						className={compact ? `${queueButton} !px-2 !py-1` : queueButton}
						disabled={busy}
						onClick={() => void run("undo")}
					>
						{compact ? "Undo" : "Undo Z"}
					</button>
				)}
			</div>
			{!!options.length && (
				<div
					aria-label="Later options"
					className={`${compact ? "order-3 w-full" : ""} flex flex-wrap gap-1`}
				>
					{options.map((option, index) => (
						<button
							data-queue-later-option={index + 1}
							type="button"
							className={compact ? `${queueButton} !px-2 !py-1` : queueButton}
							key={option.id}
							disabled={disabled || busy}
							onClick={() => void run("later", option)}
						>
							{option.label}
						</button>
					))}
				</div>
			)}
			{message && (
				<output
					className={`${compact ? "order-3 w-full" : ""} block text-[12px] text-[var(--text-secondary)]`}
				>
					{message}
				</output>
			)}
		</div>
	);
}
