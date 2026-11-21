import type { WorkspaceQueueItem } from "../../../shared/activity-queue";
import { queueAge } from "../../lib/activity-queue-view";
import { queueFocus } from "./QueueRow";
export const queueButton = `rounded-md px-3 py-2 text-[12px] transition-colors hover:bg-[var(--bg-elevated)] disabled:opacity-40 ${queueFocus}`;
export function QueuePanel({
	item,
	later,
	busy,
	canAct,
	open,
	snooze,
	done,
	bringBack,
}: {
	item: WorkspaceQueueItem;
	later: boolean;
	busy: boolean;
	canAct: boolean;
	open: () => void;
	snooze: () => void;
	done: () => void;
	bringBack: () => void;
}) {
	return (
		<aside
			aria-label="Queue item details"
			className="hidden min-h-0 w-[420px] shrink-0 flex-col overflow-y-auto border-l border-[var(--border-subtle)] bg-[var(--bg-surface)] min-[1100px]:flex"
		>
			<div className="px-6 py-6">
				<p className="mb-6 flex min-w-0 items-center gap-2 text-[11px] text-[var(--text-tertiary)]">
					<span
						className="size-2 shrink-0 rounded-sm"
						style={{
							background: item.context.projectColor || `var(--orch-${item.context.projectTint})`,
						}}
					/>
					<span
						className="truncate"
						title={`${item.context.projectName} › ${item.context.workspaceName}`}
					>
						{item.context.projectName} <span className="px-1 text-[var(--text-quaternary)]">›</span>{" "}
						{item.context.workspaceName}
					</span>
				</p>
				<h2 className="break-words text-[20px] font-medium leading-7 tracking-tight text-[var(--text)]">
					{item.subject}
				</h2>
				<p className="mt-3 break-words text-[13px] leading-6 text-[var(--text-secondary)]">
					{item.why}
				</p>
				<p className="mt-1 text-[11px] text-[var(--text-quaternary)]">
					{queueAge(item.occurredAt)}
					{item.context.provider
						? ` · ${item.context.provider === "codex" ? "Codex" : item.context.provider === "claude" ? "Claude" : item.context.provider}`
						: ""}
				</p>
				<div className="my-7 space-y-3 border-y border-[var(--border-subtle)] py-5">
					{item.evidence.slice(0, 4).map((line, i) => (
						<p
							key={`${i}-${line}`}
							className="break-words text-[12px] leading-5 text-[var(--text-secondary)]"
						>
							{line}
						</p>
					))}
					<p className="text-[11px] leading-5 text-[var(--text-quaternary)]">{item.clearsWhen}</p>
				</div>
				<button
					type="button"
					disabled={busy}
					onClick={open}
					className={`${queueButton} w-full border border-[var(--border)] bg-[var(--bg-elevated)] text-left text-[var(--text)]`}
				>
					Open workspace <kbd className="float-right text-[var(--text-tertiary)]">↵</kbd>
				</button>
				<div className="mt-3 flex items-center gap-1 text-[var(--text-tertiary)]">
					{later ? (
						<button
							type="button"
							disabled={busy || !canAct}
							onClick={bringBack}
							className={queueButton}
						>
							Bring back <kbd>B</kbd>
						</button>
					) : (
						<>
							<button
								type="button"
								disabled={busy || !canAct}
								onClick={snooze}
								className={queueButton}
							>
								Later <kbd>H</kbd>
							</button>
							<button
								type="button"
								disabled={busy || !canAct}
								onClick={done}
								className={queueButton}
							>
								Done <kbd>E</kbd>
							</button>
						</>
					)}
				</div>
			</div>
		</aside>
	);
}
