import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
	WorkspaceQueueItem,
	WorkspaceQueueListResult,
	WorkspaceQueueRevisionInput,
} from "../../../shared/activity-queue";
import { laterOptions } from "../../../shared/queue-later-options";
import { useWorkspaceQueue } from "../../hooks/useWorkspaceQueue";
import { focusQueueDestination, openQueueTarget } from "../../lib/activity-queue-navigation";
import {
	type WorkspaceQueueFilter,
	nextQueueSelection,
	orderWorkspaceItems,
	queueCounts,
	queueKeysAreTyping,
} from "../../lib/queue-model";
import { useActivityQueueStore } from "../../stores/activity-queue-store";
import { trpc } from "../../trpc/client";
import { QueuePanel, queueButton } from "./QueuePanel";
import type { AnswerQuestion } from "./QueueQuestionReply";
import { QueueRow, queueFocus } from "./QueueRow";

const EMPTY: WorkspaceQueueItem[] = [];
type Receipt = WorkspaceQueueRevisionInput;
type Result = { status: string };
type LaterOption = ReturnType<typeof laterOptions>[number];
export interface QueueScreenProps {
	data?: WorkspaceQueueListResult;
	pendingItems?: WorkspaceQueueItem[];
	initialSelectedId?: string | null;
	onSelectionChange?: (id: string | null) => void;
	loading?: boolean;
	error?: string | null;
	view: "pending" | "later";
	setView: (view: "pending" | "later") => void;
	refresh: () => Promise<unknown>;
	open: (item: WorkspaceQueueItem) => Promise<unknown>;
	done: (receipt: Receipt) => Promise<Result>;
	later: (input: Receipt & { until?: number; untilChange: boolean }) => Promise<Result>;
	bringBack: (receipt: Receipt) => Promise<Result>;
	undoDone: (receipt: Receipt) => Promise<Result>;
	answer?: AnswerQuestion;
}
export function QueueScreen({
	data,
	pendingItems,
	initialSelectedId,
	onSelectionChange,
	loading,
	error,
	view,
	setView,
	refresh,
	open,
	done,
	later,
	bringBack,
	undoDone,
	answer,
}: QueueScreenProps) {
	const [filter, setFilter] = useState<WorkspaceQueueFilter>("all");
	const [group, setGroup] = useState(false);
	const [detailsOpen, setDetailsOpen] = useState(false);
	const detailsButton = useRef<HTMLButtonElement>(null);
	const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId ?? null);
	const [mode, setMode] = useState<"list" | "later" | "help">("list");
	const [options, setOptions] = useState<LaterOption[]>([]);
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const [failure, setFailure] = useState<string | null>(null);
	const [undo, setUndo] = useState<Receipt | null>(null);
	const previousIndex = useRef(0);
	const running = useRef(false);
	const root = useRef<HTMLElement>(null);
	const returnFocus = useRef<{ removed?: string; restored?: string } | null>(null);
	const items = data?.items ?? EMPTY;
	const ordered = useMemo(() => orderWorkspaceItems(items, filter, group), [items, filter, group]);
	const counts = queueCounts(pendingItems ?? (view === "pending" ? items : EMPTY));
	const effectiveId = nextQueueSelection(ordered, selectedId, previousIndex.current);
	const selected = ordered.find((i) => i.id === effectiveId);
	const index = ordered.findIndex((i) => i.id === effectiveId);
	const detailsItem = useRef(effectiveId);
	useEffect(() => {
		// Removal/selection must not leave keyboard focus behind a narrow details overlay.
		if (detailsItem.current !== effectiveId) {
			detailsItem.current = effectiveId;
			setDetailsOpen(false);
		}
	}, [effectiveId]);
	useLayoutEffect(() => {
		const pending = returnFocus.current;
		if (
			!pending ||
			(pending.removed && ordered.some((i) => i.id === pending.removed)) ||
			(pending.restored && !ordered.some((i) => i.id === pending.restored))
		)
			return;
		returnFocus.current = null;
		if (
			document.activeElement === document.body ||
			root.current?.contains(document.activeElement)
		) {
			const row = Array.from(
				root.current?.querySelectorAll<HTMLButtonElement>("[data-queue-row]") ?? []
			).find((el) => el.dataset["queueRow"] === (pending.restored ?? effectiveId));
			(row ?? root.current)?.focus();
		}
	}, [ordered, effectiveId]);
	useEffect(() => {
		if (!data) return;
		setSelectedId(effectiveId);
		if (index >= 0) previousIndex.current = index;
		onSelectionChange?.(effectiveId);
	}, [effectiveId, index, data, onSelectionChange]);
	useEffect(() => {
		root.current?.focus();
	}, []);
	const selectionContext = `${effectiveId}:${selected?.revision}:${view}`;
	const previousContext = useRef(selectionContext);
	useEffect(() => {
		if (previousContext.current !== selectionContext) {
			previousContext.current = selectionContext;
			setMode("list");
		}
	}, [selectionContext]);
	const select = (id: string) => {
		setSelectedId(id);
		setFailure(null);
		Array.from(root.current?.querySelectorAll<HTMLButtonElement>("[data-queue-row]") ?? [])
			.find((el) => el.dataset["queueRow"] === id)
			?.focus();
	};
	const available = !!selected && !selected.stale && data?.agentStatusAvailable !== false;
	const startLater = () => {
		if (!available || busy) return;
		setOptions(laterOptions(new Date()));
		setMode("later");
	};
	const runOpen = async () => {
		if (!selected || running.current) return;
		running.current = true;
		setBusy(true);
		setFailure(null);
		try {
			await open(selected);
		} catch (err) {
			setFailure(err instanceof Error ? err.message : "Could not open this workspace.");
		} finally {
			running.current = false;
			setBusy(false);
		}
	};
	const act = async (kind: "done" | "later" | "back", option?: LaterOption) => {
		if (!selected || !available || running.current || (kind === "later" && !option)) return;
		const receipt: Receipt = {
			id: selected.id,
			revision: selected.revision,
			...(selected.members ? { members: selected.members } : {}),
		};
		const oldIndex = index;
		running.current = true;
		setBusy(true);
		setFailure(null);
		try {
			const result =
				kind === "done"
					? await done(receipt)
					: kind === "back"
						? await bringBack(receipt)
						: await later({
								...receipt,
								until: option?.until,
								untilChange: option?.untilChange ?? false,
							});
			if (!["acknowledged", "restored", "snoozed"].includes(result.status)) {
				await refresh();
				setFailure("This item changed. Review the latest activity and try again.");
				return;
			}
			setUndo(kind === "done" ? receipt : null);
			if (root.current?.contains(document.activeElement))
				returnFocus.current = { removed: receipt.id };
			setMessage(
				kind === "done" ? "Done" : kind === "back" ? "Back in the queue" : "Moved to Later"
			);
			setMode("list");
			previousIndex.current = oldIndex;
			setSelectedId(
				nextQueueSelection(
					ordered.filter((i) => i.id !== receipt.id),
					null,
					oldIndex
				)
			);
			await refresh();
		} catch (err) {
			setFailure(err instanceof Error ? err.message : "The action failed. Try again.");
		} finally {
			running.current = false;
			setBusy(false);
		}
	};
	const runUndo = async () => {
		if (!undo || running.current) return;
		running.current = true;
		setBusy(true);
		setFailure(null);
		try {
			const result = await undoDone(undo);
			await refresh();
			if (result.status !== "restored") {
				setFailure("This item changed. The earlier Done cannot be undone.");
				return;
			}
			setUndo(null);
			if (root.current?.contains(document.activeElement))
				returnFocus.current = { restored: undo.id };
			setMessage("Restored to the queue");
			setView("pending");
			setFilter("all");
			setSelectedId(undo.id);
		} catch (err) {
			setFailure(err instanceof Error ? err.message : "Could not undo Done.");
		} finally {
			running.current = false;
			setBusy(false);
		}
	};
	const sendAnswer: AnswerQuestion | undefined = answer
		? async (input) => {
				if (running.current)
					return { status: "unavailable", reason: "Another queue action is still running." };
				running.current = true;
				setBusy(true);
				try {
					return await answer(input);
				} finally {
					running.current = false;
					setBusy(false);
				}
			}
		: undefined;
	return (
		<main
			ref={root}
			tabIndex={-1}
			aria-label="Workspace queue"
			className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--bg-base)] text-[var(--text)] outline-none"
			onKeyDown={(e) => {
				if (
					e.metaKey ||
					e.ctrlKey ||
					e.altKey ||
					e.nativeEvent.isComposing ||
					queueKeysAreTyping(e.target)
				)
					return;
				if (
					e.target instanceof HTMLElement &&
					e.target.closest("button") &&
					!e.target.closest("[data-queue-row]") &&
					(e.key === "Enter" || e.key === " ")
				)
					return;
				if (e.key === "Escape") {
					setMode("list");
					root.current?.focus();
					e.preventDefault();
					return;
				}
				if (e.repeat && !["ArrowDown", "ArrowUp"].includes(e.key)) return;
				if (mode === "help") return;
				if (mode === "later") {
					const n = Number(e.key);
					const option = options[n - 1];
					if (option) {
						e.preventDefault();
						void act("later", option);
					}
					return;
				}
				let handled = true;
				if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End") {
					const next =
						e.key === "Home"
							? 0
							: e.key === "End"
								? ordered.length - 1
								: Math.max(
										0,
										Math.min(ordered.length - 1, index + (e.key === "ArrowDown" ? 1 : -1))
									);
					const row = ordered[next];
					if (row) select(row.id);
				} else if (/^[1-9]$/.test(e.key)) {
					const row = ordered[Number(e.key) - 1];
					if (row) select(row.id);
				} else if (e.key === "Enter") void runOpen();
				else if (e.key.toLowerCase() === "h" && view === "pending") startLater();
				else if (e.key.toLowerCase() === "e" && view === "pending") void act("done");
				else if (e.key.toLowerCase() === "b" && view === "later") void act("back");
				else if (e.key.toLowerCase() === "z") void runUndo();
				else if (e.key.toLowerCase() === "g") setGroup(!group);
				else if (e.key === "?") setMode("help");
				else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
					const tabs = (["all", "input", "ready"] as const).filter(
						(t) => t === "all" || t === filter || counts[t] > 0
					);
					const pos = tabs.indexOf(filter);
					setFilter(
						tabs[(pos + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length] ?? "all"
					);
				} else handled = false;
				if (handled) {
					e.preventDefault();
					e.stopPropagation();
				}
			}}
		>
			<div className="app-drag flex h-[52px] shrink-0 items-center justify-between border-b border-[var(--border-subtle)] px-5">
				<h1 className="text-[13px] font-medium">
					Queue{" "}
					<span className="ml-2 text-[11px] font-normal text-[var(--text-quaternary)]">
						Workspaces
					</span>
				</h1>
				<div className="app-no-drag flex items-center gap-2 text-[var(--text-tertiary)]">
					<button
						type="button"
						aria-label="Refresh queue"
						disabled={busy}
						onClick={() => {
							setFailure(null);
							void refresh().catch((err) => setFailure(String(err)));
						}}
						className={queueButton}
					>
						↻
					</button>
					<button
						type="button"
						aria-label="Queue keyboard shortcuts"
						onClick={() => setMode(mode === "help" ? "list" : "help")}
						className={`${queueButton} font-mono`}
					>
						?
					</button>
				</div>
			</div>
			<div className="flex h-[52px] shrink-0 items-center justify-between gap-2 border-b border-[var(--border-subtle)] px-5">
				<div
					role="tablist"
					aria-label="Workspace attention"
					className="flex h-full items-stretch gap-5"
				>
					{(["all", "input", "ready"] as const)
						.filter((t) => t === "all" || t === filter || counts[t] > 0)
						.map((t) => (
							<button
								type="button"
								role="tab"
								key={t}
								aria-selected={view === "pending" && filter === t}
								onClick={() => {
									setView("pending");
									setFilter(t);
								}}
								className={`border-b-2 text-[12px] ${queueFocus} ${view === "pending" && filter === t ? "border-[var(--text)] text-[var(--text)]" : "border-transparent text-[var(--text-tertiary)]"}`}
							>
								{t === "all" ? "All" : t === "input" ? "Needs input" : "To review"}
								<span className="ml-2 text-[10px] tabular-nums text-[var(--text-quaternary)]">
									{t === "all" ? (data?.totalPending ?? "…") : counts[t]}
								</span>
							</button>
						))}
				</div>
				<div className="flex items-center gap-2">
					<button
						type="button"
						aria-pressed={group}
						onClick={() => setGroup(!group)}
						className={`${queueButton} text-[var(--text-tertiary)]`}
					>
						Group by project <kbd>G</kbd>
					</button>
					<button
						type="button"
						aria-pressed={view === "later"}
						onClick={() => {
							setView(view === "later" ? "pending" : "later");
							setFilter("all");
						}}
						className={`${queueButton} ${view === "later" ? "bg-[var(--bg-elevated)] text-[var(--text)]" : "text-[var(--text-tertiary)]"}`}
					>
						Later <span className="ml-1 tabular-nums">{data?.laterCount ?? "…"}</span>
					</button>
				</div>
			</div>
			{(failure || error) && (
				<div
					role="alert"
					className="border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-5 py-3 text-[12px] text-[var(--st-blocked)]"
				>
					{failure || error}
				</div>
			)}
			{data?.agentStatusAvailable === false && (
				<output className="border-b border-[var(--border-subtle)] px-5 py-3 text-[12px] text-[var(--text-tertiary)]">
					Current agent status is unavailable. Reconnect the terminal service to confirm this queue.
				</output>
			)}
			{!!data?.sourceErrors.length && (
				<details className="border-b border-[var(--border-subtle)] px-5 py-2 text-[11px] text-[var(--text-tertiary)]">
					<summary className="cursor-pointer">
						Some workspace activity could not be refreshed ({data.sourceErrors.length})
					</summary>
					<ul className="space-y-1 py-2">
						{[...new Set(data.sourceErrors.map((e) => e.error))].map((e) => (
							<li key={e}>{e}</li>
						))}
					</ul>
				</details>
			)}
			<div className="relative flex min-h-0 flex-1">
				<div className="flex min-w-0 flex-1 flex-col">
					{view === "later" && (
						<p className="px-5 py-3 text-[11px] text-[var(--text-tertiary)]">
							Later · New activity returns to your queue automatically.
						</p>
					)}
					<section
						aria-label="Queue items"
						className={`min-h-0 flex-1 overflow-y-auto outline-none ${queueFocus}`}
					>
						{loading && !data ? (
							<output className="block px-5 py-12 text-[13px] text-[var(--text-tertiary)]">
								Loading workspaces…
							</output>
						) : ordered.length === 0 ? (
							<div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-16 text-center">
								<p className="text-[15px] text-[var(--text-secondary)]">
									{error
										? "Queue unavailable"
										: view === "later"
											? "Nothing set aside."
											: "Nothing needs you."}
								</p>
								<p className="text-[12px] text-[var(--text-quaternary)]">
									{error
										? "Refresh to try again."
										: view === "later"
											? "Use Later when an item can wait."
											: "Workspace updates will appear here."}
								</p>
							</div>
						) : (
							ordered.map((item, i) => (
								<div key={item.id}>
									{group &&
										(i === 0 || ordered[i - 1]?.context.projectId !== item.context.projectId) && (
											<div className="sticky top-0 bg-[var(--bg-surface)] px-5 py-2 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
												{item.context.projectName}
											</div>
										)}
									<QueueRow
										item={item}
										index={i}
										selected={effectiveId === item.id}
										later={view === "later"}
										select={() => select(item.id)}
										open={() => {
											select(item.id);
											void open(item).catch((err) =>
												setFailure(err instanceof Error ? err.message : "Could not open workspace.")
											);
										}}
									/>
								</div>
							))
						)}
					</section>
					{selected && (
						<div className="flex shrink-0 flex-wrap items-center gap-1 border-t border-[var(--border-subtle)] px-3 py-2 text-[var(--text-tertiary)] min-[1100px]:hidden">
							<button
								ref={detailsButton}
								type="button"
								aria-expanded={detailsOpen}
								aria-controls="queue-item-details"
								className={queueButton}
								onClick={() => setDetailsOpen(true)}
							>
								Details / reply
							</button>
							<button
								type="button"
								className={queueButton}
								disabled={busy}
								onClick={() => void runOpen()}
							>
								{selected.openLabel} ↵
							</button>
							{view === "later" ? (
								<button
									type="button"
									className={queueButton}
									disabled={busy || !available}
									onClick={() => void act("back")}
								>
									Bring back B
								</button>
							) : (
								<>
									<button
										type="button"
										className={queueButton}
										disabled={busy || !available}
										onClick={startLater}
									>
										Later H
									</button>
									<button
										type="button"
										className={queueButton}
										disabled={busy || !available}
										onClick={() => void act("done")}
									>
										Done E
									</button>
								</>
							)}
						</div>
					)}
				</div>
				{selected && (
					<QueuePanel
						expanded={detailsOpen}
						close={() => {
							setDetailsOpen(false);
							detailsButton.current?.focus();
						}}
						answer={sendAnswer}
						refresh={refresh}
						item={selected}
						later={view === "later"}
						busy={busy}
						canAct={available}
						open={() => void runOpen()}
						snooze={startLater}
						done={() => void act("done")}
						bringBack={() => void act("back")}
					/>
				)}
			</div>
			{message && (
				<output className="flex shrink-0 items-center justify-between border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-5 py-2 text-[12px]">
					<span>{message}</span>
					<div className="flex items-center gap-2">
						{undo && (
							<button
								type="button"
								disabled={busy}
								onClick={() => void runUndo()}
								className={`${queueButton} text-[var(--accent)]`}
							>
								Undo <kbd>Z</kbd>
							</button>
						)}
						<button
							type="button"
							aria-label="Dismiss queue notice"
							className={queueButton}
							onClick={() => setMessage(null)}
						>
							×
						</button>
					</div>
				</output>
			)}
			{mode !== "list" && (
				<dialog
					open
					className="absolute m-0 left-auto right-5 top-[108px] z-20 w-[300px] rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-3 shadow-xl"
					aria-label={mode === "later" ? "Set aside until" : "Keyboard shortcuts"}
				>
					<div className="mb-2 flex items-center justify-between px-2">
						<h2 className="text-[12px] font-medium">
							{mode === "later" ? "Later" : "Keyboard shortcuts"}
						</h2>
						<button
							type="button"
							aria-label="Close queue popover"
							className={queueButton}
							onClick={() => setMode("list")}
						>
							×
						</button>
					</div>
					{mode === "later" ? (
						options.map((option, i) => (
							<button
								key={option.id}
								type="button"
								disabled={busy}
								onClick={() => void act("later", option)}
								className={`${queueButton} flex w-full items-center gap-3 text-left`}
							>
								<kbd className="text-[var(--text-quaternary)]">{i + 1}</kbd>
								{option.label}
							</button>
						))
					) : (
						<dl className="space-y-2 px-2 pb-3 text-[12px] text-[var(--text-secondary)]">
							{[
								["↑ ↓ / 1–9", "Select item"],
								["← →", "Switch filter"],
								["↵", "Open workspace"],
								["H / E", "Later / Done"],
								["B / Z", "Bring back / Undo"],
								["G", "Group by project"],
								["Esc", "Close popover"],
							].map(([key, label]) => (
								<div key={key} className="flex justify-between gap-3">
									<dt>
										<kbd>{key}</kbd>
									</dt>
									<dd>{label}</dd>
								</div>
							))}
						</dl>
					)}
				</dialog>
			)}
		</main>
	);
}

export function QueueView() {
	const selectedId = useActivityQueueStore((s) => s.selectedWorkspaceItemId);
	const [view, setView] = useState<"pending" | "later">("pending");
	const query = useWorkspaceQueue(view);
	const pending = useWorkspaceQueue("pending");
	const utils = trpc.useUtils();
	const done = trpc.activityQueue.workspaceDone.useMutation();
	const later = trpc.activityQueue.later.useMutation();
	const bringBack = trpc.activityQueue.bringBack.useMutation();
	const undoDone = trpc.activityQueue.undoDone.useMutation();
	const answer = trpc.activityQueue.workspaceAnswer.useMutation();
	const refresh = async () => {
		await utils.activityQueue.workspaceList.invalidate();
		return query.refetch();
	};
	return (
		<QueueScreen
			data={query.data}
			pendingItems={pending.data?.items}
			initialSelectedId={selectedId}
			onSelectionChange={(id) => useActivityQueueStore.setState({ selectedWorkspaceItemId: id })}
			loading={query.isLoading}
			error={query.error?.message}
			view={view}
			setView={setView}
			refresh={refresh}
			open={async (item) => {
				const dest = await openQueueTarget(item.target);
				useActivityQueueStore.setState({ open: false });
				focusQueueDestination(dest);
			}}
			done={(input) => done.mutateAsync(input)}
			later={(input) => later.mutateAsync(input)}
			bringBack={(input) => bringBack.mutateAsync(input)}
			undoDone={(input) => undoDone.mutateAsync(input)}
			answer={(input) => answer.mutateAsync(input)}
		/>
	);
}
