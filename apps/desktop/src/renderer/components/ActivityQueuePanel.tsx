import { useEffect, useId, useMemo, useRef, useState } from "react";
import type {
	ActivityQueueItem,
	ActivityQueueKind,
	ActivityQueueListResult,
} from "../../shared/activity-queue";
import {
	QUEUE_GROUPS,
	queueAge,
	queueLocation,
	uniqueQueueItems,
} from "../lib/activity-queue-view";

export const queueControlClass =
	"rounded px-2 py-1.5 text-xs outline-offset-2 hover:bg-[var(--bg-overlay)] focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:cursor-default disabled:opacity-40";
const groupColor = {
	"agent-input": "var(--term-yellow)",
	"pr-review": "var(--accent)",
	"pr-update": "var(--color-purple)",
	"agent-ready": "var(--term-green)",
};
export interface ActivityQueuePanelProps {
	data?: ActivityQueueListResult;
	loading: boolean;
	error?: string;
	refreshing?: boolean;
	onRefresh: () => void;
	onClose: () => void;
	onOpen: (item: ActivityQueueItem) => Promise<void>;
	onHandled: (item: ActivityQueueItem) => Promise<ActivityQueueListResult>;
}

export function ActivityQueuePanel({
	data,
	loading,
	error,
	refreshing,
	onRefresh,
	onClose,
	onOpen,
	onHandled,
}: ActivityQueuePanelProps) {
	const id = useId();
	const panel = useRef<HTMLElement>(null);
	const [kind, setKind] = useState<ActivityQueueKind | "all">("all");
	const [projectId, setProjectId] = useState("all");
	const [includeHandled, setIncludeHandled] = useState(false);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [busy, setBusy] = useState<"open" | "handled" | null>(null);
	const [errors, setErrors] = useState<Record<string, string>>({});
	const [notice, setNotice] = useState("");
	const inFlight = useRef(false);
	const mounted = useRef(true);
	const items = useMemo(() => uniqueQueueItems(data?.items ?? []), [data]);
	const projects = useMemo(
		() =>
			[
				...new Map(
					items
						.filter((item) => item.projectId && item.projectName)
						.map((item) => [item.projectId as string, item.projectName as string])
				).entries(),
			].sort((a, b) => a[1].localeCompare(b[1])),
		[items]
	);
	const visible = items.filter(
		(item) =>
			(includeHandled || !item.acknowledged) &&
			(kind === "all" || item.kind === kind) &&
			(projectId === "all" || item.projectId === projectId)
	);
	const selected = visible.find((item) => item.id === selectedId) ?? visible[0];
	const selectedIndex = selected ? visible.findIndex((item) => item.id === selected.id) : -1;
	const pendingIds = new Set(visible.filter((item) => !item.acknowledged).map((item) => item.id));
	const warnings = (data?.sourceErrors ?? []).filter((source) => pendingIds.has(source.sourceId));
	const warningGroups = new Map<string, number>();
	for (const warning of warnings)
		warningGroups.set(warning.error, (warningGroups.get(warning.error) ?? 0) + 1);
	useEffect(() => {
		mounted.current = true;
		panel.current?.focus();
		return () => {
			mounted.current = false;
		};
	}, []);
	useEffect(() => {
		setSelectedId(selected?.id ?? null);
		panel.current
			?.querySelector<HTMLElement>('button[aria-current="true"]')
			?.scrollIntoView?.({ block: "nearest" });
	}, [selected?.id]);

	async function openItem(item: ActivityQueueItem) {
		if (inFlight.current) return;
		inFlight.current = true;
		setSelectedId(item.id);
		setBusy("open");
		setNotice("");
		setErrors((current) => ({ ...current, [item.id]: "" }));
		try {
			await onOpen(item);
		} catch (error) {
			if (mounted.current)
				setErrors((current) => ({
					...current,
					[item.id]:
						error instanceof Error ? error.message : "Unable to open this item. Try again.",
				}));
		} finally {
			inFlight.current = false;
			if (mounted.current) setBusy(null);
		}
	}

	async function handleAndNext(item: ActivityQueueItem) {
		if (inFlight.current || item.acknowledged) return;
		inFlight.current = true;
		setBusy("handled");
		setNotice("");
		setErrors((current) => ({ ...current, [item.id]: "" }));
		const sequence = visible.map((row) => row.id);
		let errorId = item.id;
		try {
			// Await the receipt and refreshed projection before selecting a successor.
			const refreshed = await onHandled(item);
			if (!mounted.current) return;
			const refreshedItems = uniqueQueueItems(refreshed.items).filter(
				(row) =>
					(kind === "all" || row.kind === kind) &&
					(projectId === "all" || row.projectId === projectId)
			);
			const candidates = refreshedItems.filter(
				(row) => !row.acknowledged && !(row.id === item.id && row.revision === item.revision)
			);
			const newer = candidates.find((row) => row.id === item.id && row.revision > item.revision);
			if (newer) {
				setSelectedId(newer.id);
				setNotice("New activity arrived for this item. Review it before moving on.");
				panel.current?.focus();
				return;
			}
			const index = sequence.indexOf(item.id);
			const nextIds = [...sequence.slice(index + 1), ...sequence.slice(0, index)];
			const next =
				nextIds.map((key) => candidates.find((row) => row.id === key)).find(Boolean) ??
				candidates[0];
			setSelectedId(next?.id ?? null);
			if (next) {
				errorId = next.id;
				setErrors((current) => ({ ...current, [next.id]: "" }));
				await onOpen(next);
			} else panel.current?.focus();
		} catch (error) {
			if (mounted.current)
				setErrors((current) => ({
					...current,
					[errorId]:
						error instanceof Error ? error.message : "Unable to handle this item. Try again.",
				}));
		} finally {
			inFlight.current = false;
			if (mounted.current) setBusy(null);
		}
	}

	return (
		<aside
			ref={panel}
			id="activity-queue-panel"
			aria-labelledby={`${id}-title`}
			tabIndex={-1}
			onKeyDown={(event) => {
				if (
					event.key === "Escape" &&
					!(
						event.target instanceof HTMLElement &&
						["SELECT", "INPUT", "TEXTAREA"].includes(event.target.tagName)
					)
				) {
					event.stopPropagation();
					onClose();
				}
			}}
			className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-[var(--bg-surface)] text-[var(--text)] outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--accent)]"
		>
			<header className="app-drag flex h-[52px] shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] px-3">
				<h2 id={`${id}-title`} className="text-[13px] font-semibold">
					Queue
				</h2>
				<span className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[10px] tabular-nums text-[var(--text-secondary)]">
					{data?.totalPending ?? "…"}
				</span>
				<div className="app-no-drag ml-auto flex items-center gap-0.5">
					<button
						type="button"
						className={queueControlClass}
						onClick={onRefresh}
						disabled={refreshing}
						aria-label="Refresh queue"
						title="Refresh queue"
					>
						<svg
							aria-hidden="true"
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.7"
							strokeLinecap="round"
							strokeLinejoin="round"
						>
							<path d="M20 7v5h-5M4 17v-5h5M19 12a7 7 0 0 0-12-5L4 10M5 12a7 7 0 0 0 12 5l3-3" />
						</svg>
					</button>
					<button
						type="button"
						className={queueControlClass}
						onClick={onClose}
						aria-label="Close Queue"
						title="Hide queue"
					>
						<svg
							aria-hidden="true"
							width="14"
							height="14"
							viewBox="0 0 20 20"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.7"
							strokeLinecap="round"
						>
							<path d="m5 5 10 10M15 5 5 15" />
						</svg>
					</button>
				</div>
			</header>
			<div className="shrink-0 border-b border-[var(--border-subtle)] px-3 py-2.5">
				<div className="flex min-w-0 gap-2">
					<label className="min-w-0 flex-1">
						<span className="sr-only">Category</span>
						<select
							aria-label="Category"
							disabled={!!busy}
							value={kind}
							onChange={(event) => setKind(event.target.value as ActivityQueueKind | "all")}
							className={`${queueControlClass} w-full truncate border border-[var(--border)] bg-[var(--bg-elevated)]`}
						>
							<option value="all">All categories</option>
							{QUEUE_GROUPS.map((group) => (
								<option key={group.kind} value={group.kind}>
									{group.label}
								</option>
							))}
						</select>
					</label>
					<label className="min-w-0 flex-1">
						<span className="sr-only">Project</span>
						<select
							aria-label="Project"
							disabled={!!busy}
							value={projectId}
							onChange={(event) => setProjectId(event.target.value)}
							className={`${queueControlClass} w-full truncate border border-[var(--border)] bg-[var(--bg-elevated)]`}
						>
							<option value="all">All projects</option>
							{projectId !== "all" && !projects.some(([key]) => key === projectId) && (
								<option value={projectId}>Selected project (no items)</option>
							)}
							{projects.map(([key, label]) => (
								<option key={key} value={key}>
									{label}
								</option>
							))}
						</select>
					</label>
				</div>
				<div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-[var(--text-secondary)]">
					<span>{pendingIds.size} pending in view</span>
					<label className="flex cursor-pointer items-center gap-1.5">
						<input
							type="checkbox"
							disabled={!!busy}
							checked={includeHandled}
							onChange={(event) => setIncludeHandled(event.target.checked)}
							className="accent-[var(--accent)]"
						/>
						Show handled
					</label>
				</div>
			</div>
			{error && (
				<p role="alert" className="shrink-0 px-3 py-2 text-xs text-[var(--text-secondary)]">
					Queue could not refresh: {error}
					{data ? " Showing the last available queue." : ""}
				</p>
			)}
			{data?.agentStatusAvailable === false && (
				<p aria-live="polite" className="shrink-0 px-3 py-2 text-xs text-[var(--text-secondary)]">
					Agent status is unavailable. The last confirmed agent list is shown.
				</p>
			)}
			{warnings.length > 0 && (
				<details className="shrink-0 border-b border-[var(--border-subtle)] px-3 py-2 text-[11px] text-[var(--text-secondary)]">
					<summary className="cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--accent)]">
						{warnings.length} pending {warnings.length === 1 ? "item could" : "items could"} not be
						refreshed
					</summary>
					<ul className="mt-2 max-h-24 overflow-y-auto">
						{[...warningGroups].map(([message, count]) => (
							<li key={message}>
								{message} ({count})
							</li>
						))}
					</ul>
				</details>
			)}
			<nav
				aria-label="Queue items"
				className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
				onKeyDown={(event) => {
					if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) || busy) return;
					if (!(event.target instanceof HTMLElement) || !event.target.closest("[data-queue-item]"))
						return;
					event.preventDefault();
					const index =
						event.key === "Home"
							? 0
							: event.key === "End"
								? visible.length - 1
								: Math.max(
										0,
										Math.min(
											visible.length - 1,
											selectedIndex + (event.key === "ArrowDown" ? 1 : -1)
										)
									);
					const next = visible[index];
					if (!next) return;
					setSelectedId(next.id);
					for (const button of panel.current?.querySelectorAll<HTMLButtonElement>(
						"[data-queue-item]"
					) ?? []) {
						if (button.dataset["queueItem"] === next.id) button.focus();
					}
				}}
			>
				{loading && !data && (
					<p aria-live="polite" className="px-4 py-8 text-xs text-[var(--text-secondary)]">
						Loading queue…
					</p>
				)}
				{!loading && data && visible.length === 0 && (
					<div className="px-5 py-10 text-center">
						<div className="mb-2 text-[13px] font-medium">
							{data.agentStatusAvailable === false && data.totalPending === 0
								? "Agent status unavailable"
								: data.totalPending === 0 && !includeHandled
									? "All caught up"
									: "No items in this view"}
						</div>
						<p className="text-xs leading-5 text-[var(--text-secondary)]">
							{data.agentStatusAvailable === false
								? "Reconnect to confirm the remaining work."
								: data.totalPending === 0 && !includeHandled
									? "New activity will appear here. Keep working with the queue open."
									: "Change the filters to see more items."}
						</p>
					</div>
				)}
				{QUEUE_GROUPS.map((group) => {
					const rows = visible.filter((item) => item.kind === group.kind);
					return (
						rows.length > 0 && (
							<section key={group.kind} aria-label={group.label}>
								<h3 className="sticky top-0 z-[1] flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-[10px] font-medium tracking-wide text-[var(--text-secondary)]">
									<span>{group.label}</span>
									<span className="tabular-nums">{rows.length}</span>
								</h3>
								<ul>
									{rows.map((item) => (
										<li key={item.id}>
											<button
												type="button"
												aria-label={`Open ${item.title}`}
												data-queue-item={item.id}
												tabIndex={selected?.id === item.id ? 0 : -1}
												aria-current={selected?.id === item.id ? "true" : undefined}
												disabled={!!busy}
												onClick={() => void openItem(item)}
												className={`w-full border-b border-l-2 border-b-[var(--border-subtle)] px-3 py-2.5 text-left outline-offset-[-2px] transition-colors focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${selected?.id === item.id ? "border-l-[var(--accent)] bg-[var(--accent-subtle)]" : "border-l-transparent hover:bg-[var(--bg-elevated)]"} ${item.acknowledged ? "opacity-60" : ""}`}
											>
												<span className="flex items-start gap-2">
													<span
														className="mt-1.5 size-1.5 shrink-0 rounded-full"
														style={{ background: groupColor[item.kind] }}
													/>
													<span
														className="min-w-0 flex-1 truncate text-[12px] font-medium"
														title={item.title}
													>
														{item.title}
													</span>
													<time
														dateTime={new Date(item.occurredAt).toISOString()}
														title={new Date(item.occurredAt).toLocaleString()}
														className="shrink-0 text-[10px] text-[var(--text-secondary)]"
													>
														{queueAge(item.occurredAt)}
													</time>
												</span>
												<span className="mt-1 block truncate pl-3.5 text-[10px] text-[var(--text-secondary)]">
													{queueLocation(item)}
												</span>
												<span className="mt-1 block truncate pl-3.5 text-[11px] text-[var(--text-secondary)]">
													{item.acknowledged ? "Handled" : item.summary}
												</span>
											</button>
										</li>
									))}
								</ul>
							</section>
						)
					);
				})}
			</nav>
			{selected && (
				<div className="shrink-0 border-t border-[var(--border)] bg-[var(--bg-base)]">
					<div className="flex items-center gap-1 border-b border-[var(--border-subtle)] px-3 py-1.5">
						<span className="mr-auto text-[10px] tabular-nums text-[var(--text-secondary)]">
							{selectedIndex + 1} of {visible.length}
						</span>
						<button
							type="button"
							className={queueControlClass}
							disabled={!!busy || selectedIndex <= 0}
							onClick={() => {
								const previous = visible[selectedIndex - 1];
								if (previous) void openItem(previous);
							}}
							aria-label="Previous item"
							title="Open previous item"
						>
							←
						</button>
						<button
							type="button"
							className={queueControlClass}
							disabled={!!busy || selectedIndex >= visible.length - 1}
							onClick={() => {
								const next = visible[selectedIndex + 1];
								if (next) void openItem(next);
							}}
							aria-label="Next item"
							title="Open next item"
						>
							→
						</button>
					</div>
					<div className="max-h-[25vh] overflow-y-auto px-3 py-3">
						<h3 className="break-words text-[12px] font-semibold">{selected.title}</h3>
						<p className="mt-1.5 whitespace-pre-wrap break-words text-[12px] leading-5 text-[var(--text-secondary)]">
							{selected.summary}
						</p>
						{selected.reasons.some((reason) => !selected.summary.includes(reason.label)) && (
							<p className="mt-2 text-[10px] text-[var(--text-secondary)]">
								{selected.reasons
									.filter((reason) => !selected.summary.includes(reason.label))
									.map((reason) => reason.label)
									.join(" · ")}
							</p>
						)}
						{selected.stale && (
							<p className="mt-2 text-[11px] text-[var(--text-secondary)]">
								Stale — source unavailable; this item may have changed.
							</p>
						)}
						{selected.target.type === "unavailable" && (
							<p className="mt-2 text-xs">{selected.target.reason}</p>
						)}
						{errors[selected.id] && (
							<p role="alert" className="mt-2 break-words text-xs text-[var(--term-red)]">
								{errors[selected.id]}
							</p>
						)}
					</div>
					<div className="flex gap-2 px-3 pb-3">
						<button
							type="button"
							className={`${queueControlClass} border border-[var(--border)]`}
							disabled={!!busy || selected.target.type === "unavailable"}
							onClick={() => void openItem(selected)}
						>
							Open source
						</button>
						<button
							type="button"
							className={`${queueControlClass} ml-auto bg-[var(--text)] px-3 font-medium text-[var(--bg-base)] hover:bg-[var(--text-secondary)]`}
							disabled={!!busy || selected.acknowledged}
							onClick={() => void handleAndNext(selected)}
							aria-label={`Handle ${selected.title} and open next item`}
						>
							{busy === "handled" ? "Handling…" : busy === "open" ? "Opening…" : "Handle & next"}
						</button>
					</div>
				</div>
			)}
			{notice && (
				<p
					aria-live="polite"
					className="shrink-0 truncate border-t border-[var(--border-subtle)] px-3 py-1.5 text-[10px] text-[var(--text-secondary)]"
					title={notice}
				>
					{notice}
				</p>
			)}
		</aside>
	);
}
