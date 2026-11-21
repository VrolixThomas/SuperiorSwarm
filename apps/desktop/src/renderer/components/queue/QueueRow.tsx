import type { WorkspaceQueueItem } from "../../../shared/activity-queue";
import { queueAge } from "../../lib/activity-queue-view";
import { QueueIcon } from "./QueueIcon";
export const queueFocus =
	"focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--accent)]";
export function QueueRow({
	item,
	index,
	selected,
	later,
	select,
	open,
}: {
	item: WorkspaceQueueItem;
	index: number;
	selected: boolean;
	later: boolean;
	select: () => void;
	open: () => void;
}) {
	return (
		<button
			type="button"
			aria-current={selected ? "true" : undefined}
			id={`queue-row-${index}`}
			data-queue-row={item.id}
			tabIndex={selected ? 0 : -1}
			onClick={select}
			onDoubleClick={open}
			className={`grid h-[42px] w-full min-w-0 grid-cols-[14px_16px_132px_minmax(0,1fr)_minmax(0,220px)_54px] items-center gap-3 border-b border-[var(--border-subtle)] px-5 text-left text-[12px] ${queueFocus} ${selected ? "bg-[rgba(255,255,255,0.065)]" : "hover:bg-[var(--bg-elevated)]"}`}
		>
			<span className="text-[10px] tabular-nums text-[var(--text-quaternary)]">{index + 1}</span>
			<span
				className={
					item.kind === "agent-input" ? "text-[var(--st-blocked)]" : "text-[var(--text-tertiary)]"
				}
			>
				<QueueIcon name={item.kind === "agent-input" ? "question" : "ready"} size={16} />
			</span>
			<span
				className="flex min-w-0 items-center gap-2 text-[var(--text-tertiary)]"
				title={item.context.projectName}
			>
				<span
					className="size-1.5 shrink-0 rounded-full"
					style={{
						background: item.context.projectColor || `var(--orch-${item.context.projectTint})`,
					}}
				/>
				<span className="truncate">{item.context.projectName}</span>
			</span>
			<span
				className="flex min-w-0 flex-col justify-center"
				title={`${item.subject} — ${item.sourceLabel}: ${item.why}`}
			>
				<span className="truncate leading-4 text-[var(--text)]">{item.subject}</span>
				<span className="truncate text-[10px] leading-4 text-[var(--text-tertiary)]">
					{item.sourceLabel} · {item.why}
				</span>
			</span>
			{selected ? (
				<span className="col-span-2 flex items-center justify-end gap-2 whitespace-nowrap text-[10px] text-[var(--text-tertiary)]">
					{(item.question || ["agent-done", "agent-failed"].includes(item.situation)) && (
						<span>
							<kbd>R</kbd> Reply
						</span>
					)}
					<span className="text-[var(--accent)]">
						<kbd>↵</kbd> Open
					</span>
					{later ? (
						<span>
							<kbd>B</kbd> Bring back
						</span>
					) : (
						<>
							<span>
								<kbd>H</kbd> Later
							</span>
							<span>
								<kbd>E</kbd> Done
							</span>
						</>
					)}
				</span>
			) : (
				<>
					<span
						className="truncate text-[var(--text-tertiary)]"
						title={item.evidence[0] ?? item.why}
					>
						{item.evidence[0] ?? item.why}
					</span>
					<span className="text-right text-[10px] tabular-nums text-[var(--text-quaternary)]">
						{queueAge(item.occurredAt)}
					</span>
				</>
			)}
		</button>
	);
}
