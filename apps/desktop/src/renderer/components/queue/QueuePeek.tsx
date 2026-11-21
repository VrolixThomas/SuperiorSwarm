import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { QueueEntity, WorkspaceQueueItem } from "../../../shared/activity-queue";
import { queueKeysAreTyping } from "../../lib/queue-model";
import {
	bindQueueSession,
	pendingQueueItems,
	queueOccurrenceKey,
	queueSessionStatus,
} from "../../lib/queue-navigation-session";
import { QueueLinkedWorkContext } from "./QueueLinkedWorkContext";
import { queueButton } from "./QueuePanel";
import { QueueRow } from "./QueueRow";

export function QueuePeek({
	items,
	available,
	entity,
	initialItem,
	close,
	open,
	openQueue,
	actions,
	shouldRestoreFocus,
}: {
	items: readonly WorkspaceQueueItem[];
	available: boolean;
	entity?: QueueEntity | null;
	initialItem?: WorkspaceQueueItem;
	close: () => void;
	open: (item: WorkspaceQueueItem) => void;
	openQueue: (item?: WorkspaceQueueItem) => void;
	shouldRestoreFocus?: () => boolean;
	actions: (item: WorkspaceQueueItem, disabled: boolean) => ReactNode;
}) {
	const rows = pendingQueueItems(items)
		.filter(
			(item) =>
				!entity ||
				(item.context.entity?.id === entity.id && item.context.entity.kind === entity.kind)
		)
		.slice(0, 7);
	const [selected, setSelected] = useState<WorkspaceQueueItem | null>(
		() => initialItem ?? rows[0] ?? null
	);
	const root = useRef<HTMLDialogElement>(null);
	const details = useRef<HTMLDivElement>(null);
	const restore = useRef(shouldRestoreFocus);
	restore.current = shouldRestoreFocus;
	useEffect(() => {
		const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		root.current?.focus();
		return () => {
			if (previous?.isConnected && (restore.current?.() ?? true)) previous.focus();
		};
	}, []);
	// Loading may populate an empty peek, but never replace a user's selected occurrence.
	useEffect(() => {
		if (!selected && rows[0]) setSelected(structuredClone(rows[0]));
	}, [rows, selected]);
	const status = selected
		? queueSessionStatus(bindQueueSession(selected, items), items, available)
		: "cleared";
	const canAct = status === "current";
	return createPortal(
		<div
			className="fixed inset-0 z-[100] flex items-start justify-center bg-black/40 p-3 pt-[8vh]"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) close();
			}}
		>
			<dialog
				open
				ref={root}
				aria-modal="true"
				aria-label="Queue peek"
				tabIndex={-1}
				className="relative m-0 flex max-h-[84vh] w-full max-w-[1050px] min-w-0 flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text)] shadow-xl outline-none"
				onKeyDown={(event) => {
					if (event.key === "Escape") {
						event.preventDefault();
						event.stopPropagation();
						close();
						return;
					}
					if (event.key === "Tab") {
						const controls = Array.from(
							root.current?.querySelectorAll<HTMLElement>(
								"button:not(:disabled),textarea:not(:disabled),input:not(:disabled),[tabindex='0']"
							) ?? []
						).filter(
							(el) =>
								el.getAttribute("aria-hidden") !== "true" &&
								!el.closest("[hidden]") &&
								!el.closest("details:not([open]) > :not(summary)")
						);
						const first = controls[0];
						const last = controls.at(-1);
						if (
							event.shiftKey &&
							(document.activeElement === first || document.activeElement === root.current)
						) {
							event.preventDefault();
							last?.focus();
						} else if (
							!event.shiftKey &&
							(document.activeElement === last || document.activeElement === root.current)
						) {
							event.preventDefault();
							first?.focus();
						}
						return;
					}
					if (
						event.metaKey ||
						event.ctrlKey ||
						event.altKey ||
						event.nativeEvent.isComposing ||
						queueKeysAreTyping(event.target)
					)
						return;
					// Focused controls retain their own activation semantics.
					if (
						(event.key === "Enter" || event.key === " ") &&
						(event.target as HTMLElement).closest("button:not([data-queue-row])")
					)
						return;
					if (event.repeat) return;
					const index = rows.findIndex(
						(item) => selected && queueOccurrenceKey(item) === queueOccurrenceKey(selected)
					);
					let next: WorkspaceQueueItem | undefined;
					const laterOption = details.current?.querySelector<HTMLButtonElement>(
						`[data-queue-later-option="${event.key}"]`
					);
					if (laterOption) {
						event.preventDefault();
						event.stopPropagation();
						laterOption.click();
						return;
					}
					if (event.key === "ArrowDown") next = rows[Math.min(rows.length - 1, index + 1)];
					else if (event.key === "ArrowUp") next = rows[Math.max(0, index - 1)];
					else if (/^[1-7]$/.test(event.key)) next = rows[Number(event.key) - 1];
					else if (event.key === "Enter" && selected && canAct) open(selected);
					else if (["e", "h", "z"].includes(event.key.toLowerCase()))
						details.current
							?.querySelector<HTMLButtonElement>(
								`[data-queue-${{ e: "done", h: "later", z: "undo" }[event.key.toLowerCase() as "e" | "h" | "z"]}]`
							)
							?.click();
					else if (event.key.toLowerCase() === "r")
						details.current?.querySelector<HTMLElement>("textarea")?.focus();
					else return;
					if (next) setSelected(structuredClone(next));
					event.preventDefault();
					event.stopPropagation();
				}}
			>
				<header className="flex shrink-0 items-center justify-between border-b border-[var(--border-subtle)] px-4 py-2">
					<h2 className="text-[13px] font-medium">
						{entity ? "Pending in this workspace" : "Queue peek"}
					</h2>
					<button type="button" className={queueButton} onClick={close}>
						Close · Esc
					</button>
				</header>
				<div className="flex min-h-0 flex-col overflow-y-auto min-[1100px]:flex-row">
					<div className="min-w-0 shrink-0 overflow-x-auto min-[1100px]:flex-1">
						<div className="min-w-[460px]">
							{rows.map((item, index) => (
								<QueueRow
									key={queueOccurrenceKey(item)}
									item={item}
									index={index}
									later={false}
									selected={!!selected && queueOccurrenceKey(item) === queueOccurrenceKey(selected)}
									select={() => setSelected(structuredClone(item))}
									open={() => open(item)}
								/>
							))}
						</div>
						{!rows.length && (
							<p className="p-5 text-[13px]">
								{available ? "Nothing needs you." : "Queue unavailable. Refresh to try again."}
							</p>
						)}
					</div>
					{selected && (
						<div
							ref={details}
							className="min-w-0 shrink-0 space-y-3 border-t border-[var(--border-subtle)] p-4 min-[1100px]:w-[380px] min-[1100px]:border-l min-[1100px]:border-t-0"
						>
							<p className="break-words text-[11px] text-[var(--text-tertiary)]">
								{selected.context.projectName} › {selected.context.workspaceName}
								{selected.context.terminalTitle &&
								selected.context.terminalTitle.trim().toLocaleLowerCase() !==
									selected.context.workspaceName.trim().toLocaleLowerCase()
									? ` · ${selected.context.terminalTitle}`
									: ""}
							</p>
							<h3 className="break-words text-[14px] font-medium">{selected.subject}</h3>
							<p className="break-words text-[12px]">{selected.why}</p>
							<p className="text-[11px] text-[var(--text-tertiary)]">{selected.clearsWhen}</p>
							{status !== "current" && (
								<output className="block text-[12px]">
									{status === "updated"
										? "Updated — select the latest row to act."
										: status === "cleared"
											? "Cleared — choose another item when ready."
											: "Current activity unavailable."}
								</output>
							)}
							<QueueLinkedWorkContext items={selected.context.linkedWork} />
							{actions(selected, !canAct)}
						</div>
					)}
				</div>
				<footer className="flex shrink-0 items-center justify-between border-t border-[var(--border-subtle)] px-4 py-2 text-[11px]">
					<span>↑ ↓ Select · R Reply · H Later · E Done</span>
					<button
						type="button"
						className={queueButton}
						onClick={() => openQueue(selected ?? undefined)}
					>
						Open Queue
					</button>
				</footer>
			</dialog>
		</div>,
		document.body
	);
}
