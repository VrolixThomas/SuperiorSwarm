import { useId, useRef, useState } from "react";
import type {
	WorkspaceQueueItem,
	WorkspaceQueueRevisionInput,
} from "../../../shared/activity-queue";
import { laterOptions } from "../../../shared/queue-later-options";
import { trpc } from "../../trpc/client";
import { QueueItemActions } from "./QueueItemActions";
import { queueButton } from "./QueuePanel";
import { QueueQuestionReply } from "./QueueQuestionReply";

/** Buttons only: a terminal keeps its own letter keys while the queue bar is visible. */
export function QueueCompactActions({
	item,
	disabled,
	refresh,
	onOpen,
	children,
	compact = false,
}: {
	item: WorkspaceQueueItem;
	disabled: boolean;
	refresh: () => Promise<unknown>;
	onOpen: () => void;
	children?: React.ReactNode;
	compact?: boolean;
}) {
	const done = trpc.activityQueue.workspaceDone.useMutation();
	const later = trpc.activityQueue.later.useMutation();
	const undoDone = trpc.activityQueue.undoDone.useMutation();
	const answer = trpc.activityQueue.workspaceAnswer.useMutation();
	const lock = useRef(false);
	const answerInputId = useId();
	const [busy, setBusy] = useState(false);
	const [options, setOptions] = useState<ReturnType<typeof laterOptions>>([]);
	const [message, setMessage] = useState<string | null>(null);
	const [undo, setUndo] = useState<WorkspaceQueueRevisionInput | null>(null);
	const [expanded, setExpanded] = useState(!compact);
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
		<div data-queue-compact-actions className="min-w-0 space-y-2">
			{compact && (
				<button
					type="button"
					className={queueButton}
					aria-expanded={expanded}
					onClick={() => setExpanded(!expanded)}
				>
					Details / reply
				</button>
			)}
			<div hidden={!expanded} className="max-h-[35vh] overflow-y-auto">
				{children}
				<QueueItemActions
					item={item}
					disabled={disabled || busy}
					refresh={refresh}
					onOpen={onOpen}
				/>
				{item.question && (
					<QueueQuestionReply
						inputId={answerInputId}
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
			<div className="flex flex-wrap items-center gap-1">
				<button type="button" className={queueButton} disabled={disabled || busy} onClick={onOpen}>
					Open ↵
				</button>
				<button
					type="button"
					data-queue-later
					className={queueButton}
					disabled={disabled || busy}
					onClick={() => setOptions(options.length ? [] : laterOptions(new Date()))}
				>
					Later H
				</button>
				<button
					type="button"
					data-queue-done
					className={queueButton}
					disabled={disabled || busy}
					onClick={() => void run("done")}
				>
					Done E
				</button>
				{undo && (
					<button
						type="button"
						data-queue-undo
						className={queueButton}
						disabled={busy}
						onClick={() => void run("undo")}
					>
						Undo Z
					</button>
				)}
			</div>
			{!!options.length && (
				<div aria-label="Later options" className="flex flex-wrap gap-1">
					{options.map((option, index) => (
						<button
							data-queue-later-option={index + 1}
							type="button"
							className={queueButton}
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
				<output className="block text-[12px] text-[var(--text-secondary)]">{message}</output>
			)}
		</div>
	);
}
