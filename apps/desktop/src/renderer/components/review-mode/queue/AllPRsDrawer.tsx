import { useEffect, useId, useRef, useState } from "react";
import { useRememberedReviewPath } from "../../../lib/review-path-status-cache";
import {
	type ReviewQueue,
	type ReviewQueueFacts,
	type ReviewQueuePR,
	queueStatus,
} from "../../../lib/review-queue";
import { useReviewPathSettingsStore } from "../../../stores/review-path-settings-store";
import { trpc } from "../../../trpc/client";

export interface AllPRsDrawerProps {
	queue: ReviewQueue;
	currentKey: string;
	nextKey?: string;
	onClose: () => void;
	onSelect: (pr: ReviewQueuePR) => void;
	openingKey?: string | null;
	isLoading?: boolean;
	error?: string | null;
	/** Measured facts only; absent progress stays unknown. Keys include the provider. */
	factsByKey?: ReadonlyMap<string, ReviewQueueFacts>;
}

function QueueRow({
	pr,
	current,
	next,
	openingKey,
	facts,
	onSelect,
}: {
	pr: ReviewQueuePR;
	current: boolean;
	next: boolean;
	openingKey?: string | null;
	facts?: ReviewQueueFacts;
	onSelect: (pr: ReviewQueuePR) => void;
}) {
	const scope = {
		provider: pr.provider,
		owner: pr.owner,
		repo: pr.repo,
		prNumber: pr.number,
		headSha: pr.headCommitSha ?? "",
		projectId: pr.projectId,
	};
	const enabled = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(scope.headSha);
	const remembered = useRememberedReviewPath(enabled ? scope : undefined);
	const projection = trpc.reviewPath.status.useQuery(scope, {
		enabled,
		staleTime: 1000,
		refetchInterval: 5000,
	});
	const matched = projection.data?.identity;
	const pathStatus =
		matched?.headSha === pr.headCommitSha &&
		matched?.provider === pr.provider &&
		matched.owner === pr.owner &&
		matched.repo === pr.repo &&
		matched.prNumber === pr.number
			? projection.data?.status
			: projection.data === null || projection.isError
				? undefined
				: remembered?.path?.status;
	const status = queueStatus({
		headCommitSha: pr.headCommitSha,
		pathStatus,
		...facts,
	});
	return (
		<button
			type="button"
			aria-current={current ? "page" : undefined}
			disabled={Boolean(openingKey)}
			onClick={() => onSelect(pr)}
			className={`mx-2 flex w-[calc(100%-16px)] items-center gap-3 rounded-[var(--radius-md)] px-3.5 py-2.5 text-left text-[var(--text)] disabled:cursor-wait ${current ? "bg-[var(--bg-overlay)]" : "hover:bg-[var(--bg-elevated)]"}`}
		>
			<span className="min-w-0 flex-1">
				<span className="flex items-center gap-1.5 text-[13px] font-medium">
					<span className="truncate" title={pr.title}>
						{pr.title}
					</span>
					{next && (
						<span className="shrink-0 rounded-[var(--radius-sm)] bg-[var(--accent-subtle)] px-1.5 text-[11px] leading-[18px] text-[var(--accent-hover)]">
							Next
						</span>
					)}
				</span>
				<span className="mt-0.5 block truncate text-[12px] text-[var(--text-tertiary)]">
					{pr.owner}/{pr.repo} #{pr.number} · {pr.provider === "github" ? "GitHub" : "Bitbucket"}
				</span>
			</span>
			<span
				className={`flex shrink-0 items-center gap-1 text-[12px] ${status.tone === "accent" ? "text-[var(--accent-hover)]" : status.tone === "warning" ? "text-[var(--tag-amber-fg)]" : "text-[var(--text-tertiary)]"}`}
			>
				{status.label === "Mapping" && (
					<span
						aria-hidden="true"
						className="size-3 animate-spin rounded-full border-2 border-current border-r-transparent"
					/>
				)}
				{openingKey === pr.key ? "Opening…" : status.label}
			</span>
		</button>
	);
}

/** Mount inside the relative workspace shell; the 44px top bar remains visible. */
export function AllPRsDrawer({
	queue,
	currentKey,
	nextKey,
	onClose,
	onSelect,
	openingKey,
	isLoading,
	error,
	factsByKey,
}: AllPRsDrawerProps) {
	const [filter, setFilter] = useState("");
	const [waitingExpanded, setWaitingExpanded] = useState(false);
	const filterRef = useRef<HTMLInputElement>(null);
	const titleId = useId();
	const settingsError = useReviewPathSettingsStore((s) => s.error);
	const autoMap = useReviewPathSettingsStore((s) => s.autoMapOnReviewRequest);
	const alsoReview = useReviewPathSettingsStore((s) => s.alsoReview);
	const setAutoMap = useReviewPathSettingsStore((s) => s.setAutoMapOnReviewRequest);
	const setAlsoReview = useReviewPathSettingsStore((s) => s.setAlsoReview);
	useEffect(() => {
		const previous = document.activeElement;
		filterRef.current?.focus();
		return () => {
			if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
		};
	}, []);
	const matches = (pr: ReviewQueuePR) =>
		`${pr.title} ${pr.owner}/${pr.repo} #${pr.number}`
			.toLowerCase()
			.includes(filter.trim().toLowerCase());
	const needsReview = queue.needsReview.filter(matches);
	const waiting = queue.waitingOnAuthor.filter(matches);
	const row = (pr: ReviewQueuePR) => (
		<QueueRow
			key={pr.key}
			pr={pr}
			current={pr.key === currentKey}
			next={pr.key === nextKey}
			openingKey={openingKey}
			facts={factsByKey?.get(pr.key)}
			onSelect={onSelect}
		/>
	);
	return (
		<div className="app-no-drag absolute inset-x-0 bottom-0 top-[44px] z-40">
			<button
				type="button"
				tabIndex={-1}
				aria-label="Close pull request queue"
				onClick={onClose}
				className="absolute inset-0 cursor-default bg-[var(--scrim)]"
			/>
			<dialog
				open
				aria-modal="true"
				aria-labelledby={titleId}
				className="absolute inset-y-0 left-0 m-0 flex h-full w-[440px] max-w-full flex-col border-0 border-r border-[var(--border)] bg-[var(--bg-surface)] p-0 shadow-[var(--shadow-lg)]"
				onKeyDown={(event) => {
					if (event.key === "Escape") {
						event.preventDefault();
						event.stopPropagation();
						onClose();
					}
					if (event.key !== "Tab") return;
					const controls = Array.from(
						event.currentTarget.querySelectorAll<HTMLElement>(
							'button:not(:disabled), input:not(:disabled), [tabindex="0"]'
						)
					);
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
				<div className="flex items-center gap-2 pb-3 pl-[22px] pr-3 pt-4">
					<h2 id={titleId} className="flex-1 text-[14px] font-semibold text-[var(--text)]">
						Pull requests
					</h2>
					<button
						type="button"
						aria-label="Close"
						onClick={onClose}
						className="flex size-7 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-secondary)] hover:bg-[var(--bg-overlay)]"
					>
						<svg
							aria-hidden="true"
							width="14"
							height="14"
							viewBox="0 0 16 16"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.6"
						>
							<path d="m4 4 8 8M12 4l-8 8" />
						</svg>
					</button>
				</div>
				<div className="px-4 pb-3">
					<div className="flex h-8 items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-base)] px-2.5 text-[var(--text-tertiary)]">
						<svg
							aria-hidden="true"
							width="14"
							height="14"
							viewBox="0 0 16 16"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.6"
						>
							<circle cx="7" cy="7" r="4.5" />
							<path d="m10.5 10.5 3 3" />
						</svg>
						<input
							ref={filterRef}
							aria-label="Filter pull requests"
							placeholder="Filter by title or repository"
							value={filter}
							onChange={(event) => setFilter(event.target.value)}
							className="min-w-0 flex-1 bg-transparent text-[13px] text-[var(--text)] outline-none"
						/>
					</div>
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto pb-4">
					{error && (
						<p role="alert" className="px-[22px] pb-2 text-[12px] text-[var(--color-danger)]">
							{error}
						</p>
					)}
					<h3 className="px-[22px] pb-1.5 pt-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
						Needs your review · {needsReview.length}
					</h3>
					<div className="flex flex-col gap-0.5">{needsReview.map(row)}</div>
					{needsReview.length === 0 && (
						<p className="px-[22px] py-3 text-[12px] text-[var(--text-tertiary)]">
							{isLoading
								? "Loading pull requests…"
								: filter
									? "No matching review requests."
									: "No pull requests need your review."}
						</p>
					)}
					<button
						type="button"
						aria-expanded={waitingExpanded || Boolean(filter)}
						onClick={() => setWaitingExpanded((value) => !value)}
						className="mt-3 flex w-full items-center gap-2 px-[22px] py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]"
					>
						<span aria-hidden="true">{waitingExpanded || filter ? "⌄" : "›"}</span> Waiting on the
						author · {waiting.length}
					</button>
					{(waitingExpanded || filter) && (
						<div className="flex flex-col gap-0.5">{waiting.map(row)}</div>
					)}
				</div>
				<footer className="flex flex-col gap-2.5 border-t border-[var(--border-subtle)] px-[22px] py-3.5">
					<label
						className="flex items-center gap-2 text-[12px] text-[var(--text)]"
						title="Automatically map new review requests with the configured agent."
					>
						<input
							type="checkbox"
							checked={autoMap && alsoReview}
							onChange={(event) => {
								setAutoMap(event.target.checked);
								if (event.target.checked) setAlsoReview(true);
							}}
							className="accent-[var(--accent)]"
						/>
						Map and review new requests automatically
					</label>
					<p className="text-[11px] text-[var(--text-tertiary)]">
						Uses the configured review agent for eligible new requests.
					</p>
					{settingsError && (
						<p role="alert" className="text-[12px] text-[var(--color-danger)]">
							Could not save reading-path settings: {settingsError}
						</p>
					)}
					<div className="flex items-center gap-1.5 text-[11px] text-[var(--text-tertiary)]">
						<kbd className="rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] px-1.5 font-sans text-[var(--text-secondary)]">
							⌘↓
						</kbd>{" "}
						next PR
						<kbd className="ml-2 rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] px-1.5 font-sans text-[var(--text-secondary)]">
							⌘↑
						</kbd>{" "}
						previous
					</div>
				</footer>
			</dialog>
		</div>
	);
}
