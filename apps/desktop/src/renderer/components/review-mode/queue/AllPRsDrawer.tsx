import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ReviewQueue, ReviewQueueFacts, ReviewQueuePR } from "../../../lib/review-queue";
import { useReviewPathSettingsStore } from "../../../stores/review-path-settings-store";
import { PRQueueRow } from "./PRQueueRow";

export interface AllPRsDrawerProps {
	queue: ReviewQueue;
	currentKey: string;
	nextKey?: string;
	onClose: () => void;
	onRefresh?: () => void;
	onSelect: (pr: ReviewQueuePR) => void;
	openingKey?: string | null;
	isLoading?: boolean;
	error?: string | null;
	factsByKey?: ReadonlyMap<string, ReviewQueueFacts>;
}

/** Dedicated PR overview; the current file/diff stays mounted behind it. */
export function AllPRsDrawer({
	queue,
	currentKey,
	nextKey,
	onClose,
	onRefresh,
	onSelect,
	openingKey,
	isLoading,
	error,
	factsByKey,
}: AllPRsDrawerProps) {
	const [filter, setFilter] = useState("");
	const [section, setSection] = useState<"needs" | "waiting">("needs");
	const [repository, setRepository] = useState("");
	const input = useRef<HTMLInputElement>(null);
	const titleId = useId();
	const settings = useReviewPathSettingsStore();
	const all = [...queue.needsReview, ...queue.waitingOnAuthor];
	const repos = useMemo(
		() =>
			[
				...new Set(
					[...queue.needsReview, ...queue.waitingOnAuthor].map((pr) => `${pr.owner}/${pr.repo}`)
				),
			].sort(),
		[queue]
	);
	const current = all.find((pr) => pr.key === currentKey);
	const selected = section === "needs" ? queue.needsReview : queue.waitingOnAuthor;
	const needle = filter.trim().toLowerCase();
	const visible = selected.filter(
		(pr) =>
			(!repository || `${pr.owner}/${pr.repo}` === repository) &&
			`${pr.title} ${pr.owner}/${pr.repo} #${pr.number} ${pr.author ?? ""}`
				.toLowerCase()
				.includes(needle)
	);
	useEffect(() => {
		const previous = document.activeElement;
		input.current?.focus();
		return () => {
			if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
		};
	}, []);
	return (
		<dialog
			open
			aria-modal="true"
			aria-label="Pull request overview"
			aria-labelledby={titleId}
			className="app-no-drag absolute inset-x-0 bottom-0 top-[44px] z-40 m-0 flex h-[calc(100%-44px)] w-full max-w-none flex-col border-0 bg-[var(--bg-base)] p-0 text-[var(--text)]"
			onKeyDown={(event) => {
				if (event.key === "Escape") {
					event.preventDefault();
					event.stopPropagation();
					onClose();
				}
				if (event.key !== "Tab") return;
				const controls = Array.from(
					event.currentTarget.querySelectorAll<HTMLElement>(
						"button:not(:disabled),input:not(:disabled),select:not(:disabled),summary"
					)
				).filter((control) => {
					if (control.closest("[hidden]")) return false;
					let parent = control.parentElement;
					while (parent && parent !== event.currentTarget) {
						if (
							parent.tagName === "DETAILS" &&
							!parent.hasAttribute("open") &&
							!parent.querySelector(":scope > summary")?.contains(control)
						)
							return false;
						parent = parent.parentElement;
					}
					return true;
				});
				const first = controls[0];
				const last = controls.at(-1);
				if (event.shiftKey && document.activeElement === first) {
					event.preventDefault();
					last?.focus();
				} else if (!event.shiftKey && document.activeElement === last) {
					event.preventDefault();
					first?.focus();
				}
			}}
		>
			<div className="mx-auto flex min-h-0 w-full max-w-[1220px] flex-1 flex-col px-[32px] pb-[20px] pt-[28px]">
				<header className="mb-[24px] flex shrink-0 items-start justify-between gap-[24px]">
					<div>
						<h1 id={titleId} className="text-[24px] font-semibold tracking-tight">
							Pull requests
						</h1>
						<p className="mt-[6px] text-[13px] text-[var(--text-secondary)]">
							Choose what to review next. Your own pull requests are excluded.
						</p>
					</div>
					<button
						type="button"
						aria-label="Back to review"
						title={current?.title}
						onClick={onClose}
						className="flex shrink-0 items-center gap-[8px] rounded-[6px] border border-[var(--border)] bg-[var(--bg-surface)] px-[12px] py-[8px] text-[13px] hover:bg-[var(--bg-overlay)]"
					>
						← Back to review
						{current && <span className="text-[var(--text-tertiary)]">#{current.number}</span>}
					</button>
				</header>
				<div className="mb-[16px] flex shrink-0 flex-wrap items-center gap-[12px]">
					<div className="flex gap-[4px] rounded-[8px] bg-[var(--bg-surface)] p-[4px]">
						{(
							[
								{ key: "needs", label: "Needs your review", count: queue.needsReview.length },
								{ key: "waiting", label: "Waiting on author", count: queue.waitingOnAuthor.length },
							] as const
						).map((tab) => (
							<button
								key={tab.key}
								type="button"
								aria-pressed={section === tab.key}
								onClick={() => setSection(tab.key)}
								className={`rounded-[5px] px-[12px] py-[7px] text-[13px] ${section === tab.key ? "bg-[var(--bg-overlay)] text-[var(--text)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"}`}
							>
								{tab.label}
								<span className="ml-[8px] tabular-nums text-[var(--text-tertiary)]">
									{tab.count}
								</span>
							</button>
						))}
					</div>
					<div className="flex-1" />
					{onRefresh && (
						<button
							type="button"
							onClick={onRefresh}
							disabled={isLoading}
							className="h-[36px] rounded-[6px] border border-[var(--border)] px-[12px] text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-overlay)]"
						>
							Refresh list
						</button>
					)}
					<select
						aria-label="Filter by repository"
						value={repository}
						onChange={(event) => setRepository(event.target.value)}
						className="h-[36px] max-w-[240px] rounded-[6px] border border-[var(--border)] bg-[var(--bg-surface)] px-[10px] text-[12px]"
					>
						<option value="">All repositories</option>
						{repos.map((repo) => (
							<option key={repo} value={repo}>
								{repo}
							</option>
						))}
					</select>
					<input
						ref={input}
						aria-label="Filter pull requests"
						value={filter}
						onChange={(event) => setFilter(event.target.value)}
						placeholder="Search title, repository, author or #…"
						className="h-[36px] w-[300px] max-w-full rounded-[6px] border border-[var(--border)] bg-[var(--bg-surface)] px-[12px] text-[13px] outline-none focus:border-[var(--accent)]"
					/>
				</div>
				{error && (
					<div
						role="alert"
						className="mb-[12px] shrink-0 rounded-[6px] border border-[var(--border)] bg-[var(--bg-surface)] p-[12px] text-[13px] text-[var(--color-danger)]"
					>
						{error}
					</div>
				)}
				<div className="min-h-0 flex-1 overflow-y-auto rounded-[10px] border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
					<div className="sticky top-0 z-10 grid grid-cols-[minmax(0,1fr)_140px] gap-[20px] border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-[20px] py-[10px] text-[11px] font-medium uppercase tracking-wide text-[var(--text-tertiary)] min-[1000px]:grid-cols-[minmax(0,1fr)_150px_140px]">
						<span>Pull request</span>
						<span className="hidden min-[1000px]:block">Activity</span>
						<span className="text-right">Reading path</span>
					</div>
					{visible.map((pr) => (
						<PRQueueRow
							key={pr.key}
							pr={pr}
							current={pr.key === currentKey}
							next={pr.key === nextKey}
							openingKey={openingKey}
							facts={factsByKey?.get(pr.key)}
							onSelect={(item) => {
								if (item.key === currentKey) onClose();
								else onSelect(item);
							}}
						/>
					))}
					{!visible.length && (
						<div className="px-[24px] py-[48px] text-center text-[13px] text-[var(--text-secondary)]">
							{isLoading
								? "Loading pull requests…"
								: needle || repository
									? "No pull requests match these filters."
									: section === "needs"
										? "No pull requests need your review."
										: "No pull requests are waiting on the author."}
						</div>
					)}
				</div>
				<footer className="mt-[14px] flex shrink-0 flex-wrap items-center justify-between gap-[12px] text-[12px] text-[var(--text-tertiary)]">
					<span>
						{visible.length} of {selected.length} pull requests · ⌘↓ next · ⌘↑ previous
					</span>
					<details className="relative">
						<summary className="cursor-pointer text-[var(--text-secondary)]">
							Automatic mapping
						</summary>
						<div className="absolute bottom-full right-0 mb-[8px] w-[300px] rounded-[8px] border border-[var(--border)] bg-[var(--bg-elevated)] p-[14px] shadow-[var(--shadow-lg)]">
							<label className="flex items-start gap-[8px] text-[13px] text-[var(--text)]">
								<input
									type="checkbox"
									checked={settings.autoMapOnReviewRequest && settings.alsoReview}
									onChange={(event) => {
										settings.setAutoMapOnReviewRequest(event.target.checked);
										if (event.target.checked) settings.setAlsoReview(true);
									}}
									className="mt-[3px] accent-[var(--accent)]"
								/>
								Map and review new requests automatically
							</label>
							{settings.error && (
								<p role="alert" className="mt-[8px] text-[12px] text-[var(--color-danger)]">
									Could not save settings: {settings.error}
								</p>
							)}
						</div>
					</details>
				</footer>
			</div>
		</dialog>
	);
}
