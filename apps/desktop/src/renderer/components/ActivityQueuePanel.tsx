import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
	"rounded px-2 py-1 text-xs outline-offset-2 hover:bg-[var(--bg-overlay)] focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:opacity-50";

export interface ActivityQueuePanelProps {
	data?: ActivityQueueListResult;
	loading: boolean;
	error?: string;
	refreshing?: boolean;
	onRefresh: () => void;
	onClose: () => void;
	onOpen: (item: ActivityQueueItem) => Promise<void>;
	onHandled: (item: ActivityQueueItem) => Promise<void>;
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
	const dialog = useRef<HTMLDialogElement>(null);
	const [kind, setKind] = useState<ActivityQueueKind | "all">("all");
	const [projectId, setProjectId] = useState("all");
	const [includeHandled, setIncludeHandled] = useState(false);
	const [busy, setBusy] = useState<Record<string, "open" | "handled">>({});
	const [errors, setErrors] = useState<Record<string, string>>({});
	const inFlight = useRef(new Set<string>());
	const mounted = useRef(true);
	const items = useMemo(() => uniqueQueueItems(data?.items ?? []), [data]);
	const projects = useMemo(
		() =>
			[
				...new Map(
					items
						.filter((i) => i.projectId && i.projectName)
						.map((i) => [i.projectId as string, i.projectName as string])
				).entries(),
			].sort((a, b) => a[1].localeCompare(b[1])),
		[items]
	);
	const visible = items.filter(
		(i) =>
			(includeHandled || !i.acknowledged) &&
			(kind === "all" || i.kind === kind) &&
			(projectId === "all" || i.projectId === projectId)
	);
	useEffect(() => {
		mounted.current = true;
		const panel = dialog.current;
		panel?.showModal();
		panel?.focus();
		return () => {
			mounted.current = false;
			panel?.close();
		};
	}, []);
	async function act(item: ActivityQueueItem, action: "open" | "handled") {
		if (inFlight.current.has(item.id)) return;
		inFlight.current.add(item.id);
		setBusy((current) => ({ ...current, [item.id]: action }));
		setErrors((current) => ({ ...current, [item.id]: "" }));
		try {
			await (action === "open" ? onOpen(item) : onHandled(item));
			// Handled may remove the focused row. Keep keyboard focus inside the panel.
			if (action === "handled" && mounted.current) dialog.current?.focus();
		} catch (error) {
			if (mounted.current)
				setErrors((current) => ({
					...current,
					[item.id]:
						error instanceof Error
							? error.message
							: "Unable to complete this action. Please retry.",
				}));
		} finally {
			inFlight.current.delete(item.id);
			if (mounted.current)
				setBusy((current) => {
					const next = { ...current };
					delete next[item.id];
					return next;
				});
		}
	}
	return createPortal(
		<dialog
			ref={dialog}
			id="activity-queue-panel"
			aria-labelledby={`${id}-title`}
			aria-modal="true"
			aria-describedby={`${id}-help`}
			tabIndex={-1}
			onCancel={(event) => {
				event.preventDefault();
				onClose();
			}}
			onKeyDown={(event) => {
				if (event.key !== "Tab") return;
				const controls = event.currentTarget.querySelectorAll<HTMLElement>(
					"button:not([disabled]), select:not([disabled]), input:not([disabled])"
				);
				const first = controls[0];
				const last = controls[controls.length - 1];
				if (event.shiftKey && (event.target === first || event.target === event.currentTarget)) {
					event.preventDefault();
					last?.focus();
				} else if (!event.shiftKey && event.target === last) {
					event.preventDefault();
					first?.focus();
				}
			}}
			className="fixed m-0 flex-col rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-0 text-[var(--text)] shadow-[var(--shadow-lg)] backdrop:bg-black/20 open:flex focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
			style={{
				left: 8,
				top: 60,
				width: "min(540px, calc(100vw - 16px))",
				maxHeight: "calc(100dvh - 76px)",
			}}
		>
			<header className="flex shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] p-3">
				<h2 id={`${id}-title`} className="flex-1 text-sm font-semibold">
					Queue {data?.totalPending ?? "…"}
				</h2>
				<button
					type="button"
					className={queueControlClass}
					onClick={onRefresh}
					disabled={refreshing}
				>
					{refreshing ? "Refreshing…" : "Refresh"}
				</button>
				<button
					type="button"
					className={queueControlClass}
					onClick={onClose}
					aria-label="Close Queue"
				>
					Close
				</button>
			</header>
			<div className="min-h-0 overflow-y-auto p-3">
				<p id={`${id}-help`} className="mb-3 text-xs text-[var(--text-secondary)]">
					Open goes to the source. Handled clears this occurrence from your queue only.
				</p>
				<div className="mb-3 flex flex-wrap items-end gap-2 text-xs">
					<label className="flex flex-col gap-1" htmlFor={`${id}-category`}>
						Category
						<select
							id={`${id}-category`}
							value={kind}
							onChange={(e) => setKind(e.target.value as ActivityQueueKind | "all")}
							className={`${queueControlClass} max-w-full border border-[var(--border)] bg-[var(--bg-elevated)]`}
						>
							<option value="all">All categories</option>
							{QUEUE_GROUPS.map((group) => (
								<option key={group.kind} value={group.kind}>
									{group.label}
								</option>
							))}
						</select>
					</label>
					<label className="flex min-w-0 flex-col gap-1" htmlFor={`${id}-project`}>
						Project
						<select
							id={`${id}-project`}
							value={projectId}
							onChange={(e) => setProjectId(e.target.value)}
							className={`${queueControlClass} max-w-[220px] border border-[var(--border)] bg-[var(--bg-elevated)]`}
						>
							<option value="all">All projects</option>
							{projectId !== "all" && !projects.some(([id]) => id === projectId) && (
								<option value={projectId}>Selected project (no items)</option>
							)}
							{projects.map(([value, label]) => (
								<option key={value} value={value}>
									{label}
								</option>
							))}
						</select>
					</label>
					<label className={`${queueControlClass} flex items-center gap-1.5`}>
						<input
							type="checkbox"
							checked={includeHandled}
							onChange={(e) => setIncludeHandled(e.target.checked)}
							className="focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
						/>
						Show handled
					</label>
				</div>
				{loading && !data && (
					<p aria-live="polite" className="py-6 text-sm">
						Loading queue…
					</p>
				)}
				{error && (
					<p role="alert" className="mb-3 text-xs text-[var(--text-secondary)]">
						Queue could not refresh: {error}
						{data ? " Showing the last available queue." : ""}
					</p>
				)}
				{!!data?.sourceErrors.length && (
					<div
						aria-live="polite"
						className="mb-3 rounded border border-[var(--border)] p-2 text-xs"
					>
						<p>Some sources are unavailable. Pending items are retained.</p>
						<ul>
							{data.sourceErrors.map((source) => (
								<li key={source.sourceId} className="break-words">
									{items.find((item) => item.id === source.sourceId)?.title ?? "Activity source"}:{" "}
									{source.error}
								</li>
							))}
						</ul>
					</div>
				)}
				{data && (
					<p aria-live="polite" className="mb-3 text-xs text-[var(--text-secondary)]">
						{visible.filter((i) => !i.acknowledged).length} pending in this view ·{" "}
						{data.totalPending} pending across all projects
						{includeHandled ? ` · ${visible.filter((i) => i.acknowledged).length} handled` : ""}
					</p>
				)}
				{!loading && data && visible.length === 0 && (
					<p className="py-6 text-sm">
						{data.totalPending === 0 && !includeHandled
							? "All caught up. No pending items."
							: "No items match these filters."}
					</p>
				)}
				{QUEUE_GROUPS.map((group) => {
					const rows = visible.filter((i) => i.kind === group.kind);
					return (
						rows.length > 0 && (
							<section key={group.kind} aria-labelledby={`${id}-${group.kind}`} className="mb-4">
								<h3
									id={`${id}-${group.kind}`}
									className="mb-2 text-xs font-semibold text-[var(--text-secondary)]"
								>
									{group.label}
								</h3>
								<ul className="space-y-2">
									{rows.map((item) => (
										<li
											key={item.id}
											className="rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] p-3"
										>
											<div className="flex items-start gap-2">
												<h4 className="min-w-0 flex-1 break-words text-sm font-medium">
													{item.title}
												</h4>
												<time
													dateTime={new Date(item.occurredAt).toISOString()}
													title={new Date(item.occurredAt).toLocaleString()}
													className="shrink-0 text-[10px] text-[var(--text-secondary)]"
												>
													{queueAge(item.occurredAt)}
												</time>
											</div>
											<p className="mt-1 break-words text-[11px] text-[var(--text-secondary)]">
												{queueLocation(item)}
											</p>
											<p className="mt-2 break-words text-xs">{item.summary}</p>
											<ul className="mt-1 text-xs text-[var(--text-secondary)]">
												{item.reasons
													.filter((reason) => !item.summary.includes(reason.label))
													.map((reason, index) => (
														<li key={`${reason.code}-${index}`}>{reason.label}</li>
													))}
											</ul>
											{item.stale && (
												<p className="mt-2 text-xs">
													Stale — source unavailable; this item may have changed.
												</p>
											)}
											{item.target.type === "unavailable" && (
												<p className="mt-2 text-xs">{item.target.reason}</p>
											)}
											{item.acknowledged && <p className="mt-2 text-xs">Handled</p>}
											<div className="mt-2 flex gap-2">
												<button
													type="button"
													className={`${queueControlClass} border border-[var(--border)]`}
													disabled={!!busy[item.id] || item.target.type === "unavailable"}
													aria-label={`Open ${item.title}`}
													onClick={() => void act(item, "open")}
												>
													{busy[item.id] === "open" ? "Opening…" : "Open"}
												</button>
												<button
													type="button"
													className={queueControlClass}
													disabled={!!busy[item.id] || item.acknowledged}
													aria-label={`Mark ${item.title} handled`}
													onClick={() => void act(item, "handled")}
												>
													{busy[item.id] === "handled" ? "Handling…" : "Handled"}
												</button>
											</div>
											{errors[item.id] && (
												<p role="alert" className="mt-2 break-words text-xs">
													{errors[item.id]}
												</p>
											)}
										</li>
									))}
								</ul>
							</section>
						)
					);
				})}
			</div>
		</dialog>,
		document.body
	);
}
