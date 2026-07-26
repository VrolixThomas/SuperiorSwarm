import { useEffect, useMemo, useRef, useState } from "react";
import type { AIDraftThread, PRContext } from "../../../shared/github-types";
import {
	type ReviewVerdict,
	type SubmitOutcome,
	hasSubmitPayload,
} from "../../lib/pr-review-submit";
import { threadExcerpt } from "../../lib/pr-review-threads";
import { trpc } from "../../trpc/client";

interface SubmitReviewPopoverProps {
	prCtx: PRContext;
	draftId: string | null;
	acceptedThreads: AIDraftThread[];
	pendingCount: number;
	onClose: () => void;
	onSubmitted: () => void;
}

const VERDICTS: Array<{ label: string; value: ReviewVerdict }> = [
	{ label: "Comment", value: "COMMENT" },
	{ label: "Approve", value: "APPROVE" },
	{ label: "Request changes", value: "REQUEST_CHANGES" },
];

function lineLabel(thread: AIDraftThread): string {
	return thread.line == null ? thread.path : `${thread.path}:${thread.line}`;
}

export function SubmitReviewPopover({
	prCtx,
	draftId,
	acceptedThreads,
	pendingCount,
	onClose,
	onSubmitted,
}: SubmitReviewPopoverProps) {
	const panelRef = useRef<HTMLDivElement>(null);
	const [verdict, setVerdict] = useState<ReviewVerdict>("COMMENT");
	const [body, setBody] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [outcome, setOutcome] = useState<SubmitOutcome | null>(null);
	const utils = trpc.useUtils();
	const updateDraftComment = trpc.aiReview.updateDraftComment.useMutation({
		onSuccess: () => {
			void utils.aiReview.getReviewDrafts.invalidate();
			void utils.aiReview.getReviewDraft.invalidate();
		},
	});
	const publishDraftReview = trpc.aiReview.submitReview.useMutation();
	const submitProviderReview = trpc.review.submitReview.useMutation();
	const nothingToSubmit = !hasSubmitPayload(acceptedThreads.length, verdict, body);
	const canSubmit = !submitting && !nothingToSubmit;

	const acceptedCountLabel = useMemo(() => {
		const count = acceptedThreads.length;
		return `${count} accepted comment${count === 1 ? "" : "s"}`;
	}, [acceptedThreads.length]);

	useEffect(() => {
		function onPointerDown(event: PointerEvent) {
			if (!panelRef.current || !(event.target instanceof Node)) return;
			if (!panelRef.current.contains(event.target)) onClose();
		}

		function onKeyDown(event: KeyboardEvent) {
			if (event.key !== "Escape") return;
			event.preventDefault();
			event.stopPropagation();
			onClose();
		}

		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [onClose]);

	const handleSubmit = async () => {
		if (!canSubmit) return;
		setSubmitting(true);
		setOutcome(null);
		try {
			if (draftId) {
				const result = await publishDraftReview.mutateAsync({ draftId, verdict, body });
				const mapped: SubmitOutcome = {
					posted: result.postedCount,
					failed: result.failedCount,
					skipped: result.skippedCount,
					errors: result.errors,
					verdictSubmitted: result.verdictSubmitted,
					skippedVerdict:
						!result.verdictSubmitted &&
						(verdict !== "COMMENT" || body.trim().length > 0) &&
						(result.failedCount > 0 || result.skippedCount > 0),
				};
				setOutcome(mapped);
				if (result.success && (result.postedCount > 0 || result.verdictSubmitted)) {
					onSubmitted();
				}
				return;
			}

			if (acceptedThreads.length > 0) {
				setOutcome({
					posted: 0,
					failed: acceptedThreads.length,
					skipped: 0,
					errors: ["The review draft is unavailable. Refresh Review Mode and try again."],
					verdictSubmitted: false,
					skippedVerdict: true,
				});
				return;
			}

			await submitProviderReview.mutateAsync({
				provider: prCtx.provider,
				owner: prCtx.owner,
				repo: prCtx.repo,
				prNumber: prCtx.number,
				verdict,
				body: body.trim(),
			});
			setOutcome({
				posted: 0,
				failed: 0,
				skipped: 0,
				errors: [],
				verdictSubmitted: true,
				skippedVerdict: false,
			});
			onSubmitted();
		} catch (err) {
			setOutcome({
				posted: 0,
				failed: 1,
				skipped: 0,
				errors: [err instanceof Error ? err.message : "Review submission failed"],
				verdictSubmitted: false,
				skippedVerdict: false,
			});
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<div
			ref={panelRef}
			className="absolute right-3 top-11 z-[60] w-[420px] overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-surface)] shadow-[var(--shadow-lg)]"
		>
			<div className="border-b border-[var(--border-subtle)] px-4 py-3">
				<div className="text-[13px] font-semibold text-[var(--text)]">Submit review</div>
				<div className="mt-0.5 text-[11px] text-[var(--text-quaternary)]">
					{acceptedCountLabel}
					{pendingCount > 0 ? ` · ${pendingCount} untriaged` : ""}
				</div>
			</div>

			<div className="space-y-3 px-4 py-3">
				<div className="flex rounded-[var(--radius-sm)] bg-[var(--bg-base)] p-0.5">
					{VERDICTS.map((item) => (
						<button
							key={item.value}
							type="button"
							aria-pressed={verdict === item.value}
							onClick={() => setVerdict(item.value)}
							className={[
								"min-w-0 flex-1 rounded-[var(--radius-sm)] px-2 py-1 text-[12px] font-medium transition-colors duration-[120ms]",
								verdict === item.value
									? "bg-[var(--bg-elevated)] text-[var(--text)] shadow-[var(--shadow-sm)]"
									: "text-[var(--text-tertiary)] hover:bg-[var(--bg-overlay)] hover:text-[var(--text-secondary)]",
							].join(" ")}
						>
							{item.label}
						</button>
					))}
				</div>

				<textarea
					value={body}
					onChange={(event) => setBody(event.target.value)}
					rows={3}
					placeholder="Summary comment (optional)"
					className="w-full resize-none rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-2 text-[12px] text-[var(--text)] placeholder:text-[var(--text-quaternary)] outline-none transition-colors duration-[120ms] focus:border-[var(--accent)]"
				/>

				<div className="max-h-[220px] overflow-y-auto rounded-[var(--radius-sm)] border border-[var(--border-subtle)]">
					{acceptedThreads.length === 0 ? (
						<div className="px-3 py-3 text-[12px] text-[var(--text-quaternary)]">
							No accepted AI comments to post. Accept comments, pick a verdict, or add a summary to
							submit.
						</div>
					) : (
						acceptedThreads.map((thread) => (
							<div
								key={thread.id}
								className="flex min-w-0 items-start gap-2 border-b border-[var(--border-subtle)] px-3 py-2 last:border-b-0"
							>
								<div className="min-w-0 flex-1">
									<div className="truncate font-mono text-[11px] text-[var(--text-tertiary)]">
										{lineLabel(thread)}
									</div>
									<div className="mt-0.5 truncate text-[12px] text-[var(--text-secondary)]">
										{threadExcerpt(thread) || "No comment body"}
									</div>
								</div>
								<button
									type="button"
									onClick={() =>
										updateDraftComment.mutate({
											commentId: thread.draftCommentId,
											status: "edited",
										})
									}
									className="shrink-0 rounded-[var(--radius-sm)] px-2 py-1 text-[12px] font-medium text-[var(--text-tertiary)] transition-colors duration-[120ms] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)]"
								>
									Remove
								</button>
							</div>
						))
					)}
				</div>

				{outcome && (
					<div
						className={[
							"rounded-[var(--radius-sm)] px-3 py-2 text-[12px]",
							outcome.failed > 0 || outcome.skipped > 0
								? "bg-[var(--danger-subtle)] text-[var(--color-danger)]"
								: "bg-[var(--success-subtle)] text-[var(--color-success)]",
						].join(" ")}
					>
						<div>
							{outcome.posted} posted
							{outcome.failed > 0 ? ` · ${outcome.failed} failed` : ""}
							{outcome.skipped > 0 ? ` · ${outcome.skipped} skipped` : ""}
							{outcome.skippedVerdict ? " · verdict skipped" : ""}
						</div>
						{outcome.errors.length > 0 && (
							<div className="mt-1 max-h-[64px] overflow-y-auto font-mono text-[11px]">
								{outcome.errors.map((error) => (
									<div key={error}>{error}</div>
								))}
							</div>
						)}
					</div>
				)}
			</div>

			<div className="flex justify-end gap-2 border-t border-[var(--border-subtle)] px-4 py-3">
				<button
					type="button"
					onClick={onClose}
					className="rounded-[var(--radius-sm)] px-3 py-1.5 text-[12px] font-medium text-[var(--text-tertiary)] transition-colors duration-[120ms] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)]"
				>
					Cancel
				</button>
				<button
					type="button"
					disabled={!canSubmit}
					onClick={handleSubmit}
					className="rounded-[var(--radius-sm)] bg-[var(--accent)] px-3 py-1.5 text-[12px] font-semibold text-[var(--accent-foreground)] transition-opacity duration-[120ms] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
				>
					{submitting ? "Submitting..." : "Submit review"}
				</button>
			</div>
		</div>
	);
}
