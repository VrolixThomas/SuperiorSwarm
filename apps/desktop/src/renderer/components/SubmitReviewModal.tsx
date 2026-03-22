import { useEffect, useRef, useState } from "react";
import type { AIDraftThread, PRContext } from "../../shared/github-types";
import { trpc } from "../trpc/client";

interface SubmitReviewModalProps {
	prCtx: PRContext;
	aiThreads: AIDraftThread[];
	pendingCount: number;
	headCommitOid: string;
	onClose: () => void;
	onSubmitted: () => void;
}

export function SubmitReviewModal({
	prCtx,
	aiThreads,
	pendingCount,
	headCommitOid,
	onClose,
	onSubmitted,
}: SubmitReviewModalProps) {
	const [body, setBody] = useState("");
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [result, setResult] = useState<{
		posted: number;
		failed: number;
		errors: string[];
	} | null>(null);

	const createThread = trpc.github.createReviewThread.useMutation();
	const updateDraftComment = trpc.aiReview.updateDraftComment.useMutation();
	const submitReview = trpc.github.submitReview.useMutation();

	const handleSubmit = async (verdict: "COMMENT" | "APPROVE" | "REQUEST_CHANGES") => {
		setIsSubmitting(true);
		setResult(null);

		if (!headCommitOid) {
			setResult({ posted: 0, failed: aiThreads.length, errors: ["Missing head commit SHA"] });
			setIsSubmitting(false);
			return;
		}

		// Post all pending comments as new review threads
		let posted = 0;
		let failed = 0;
		const errors: string[] = [];
		for (const comment of aiThreads) {
			try {
				await createThread.mutateAsync({
					owner: prCtx.owner,
					repo: prCtx.repo,
					prNumber: prCtx.number,
					body: comment.userEdit ?? comment.body,
					commitId: headCommitOid,
					path: comment.path,
					...(comment.line != null ? { line: comment.line, side: comment.diffSide } : {}),
				});
				await updateDraftComment.mutateAsync({
					commentId: comment.draftCommentId,
					status: "submitted",
				});
				posted++;
			} catch (err) {
				failed++;
				const msg =
					err instanceof Error ? err.message : typeof err === "string" ? err : "Unknown error";
				errors.push(`${comment.path}${comment.line != null ? `:${comment.line}` : ""} — ${msg}`);
				console.error("[SubmitReview] Failed to post comment:", comment.path, comment.line, err);
				// Mark failed comment as error so user can see and remove it
				try {
					await updateDraftComment.mutateAsync({
						commentId: comment.draftCommentId,
						status: "error",
					});
				} catch {
					// Best-effort — don't block the loop
				}
			}
		}

		if (aiThreads.length > 0) {
			setResult({ posted, failed, errors });
		}

		// Submit verdict — only when there's an explicit verdict or body text.
		// "COMMENT" with empty body just posts the inline comments (already done above).
		const needsVerdict = verdict !== "COMMENT" || body.trim().length > 0;

		if (needsVerdict) {
			// Skip verdict if all comments failed
			if (failed > 0 && posted === 0 && aiThreads.length > 0) {
				setIsSubmitting(false);
				return;
			}

			try {
				await submitReview.mutateAsync({
					owner: prCtx.owner,
					repo: prCtx.repo,
					prNumber: prCtx.number,
					verdict,
					body,
				});
			} catch (err) {
				const msg = err instanceof Error ? err.message : "Review submission failed";
				console.error("[SubmitReview] Failed to submit verdict:", err);
				errors.push(msg);
				failed++;
				setResult({ posted, failed, errors });
				setIsSubmitting(false);
				return;
			}
		}

		if (posted > 0 || aiThreads.length === 0) {
			onSubmitted();
		}
		setIsSubmitting(false);
	};

	const overlayRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const handleKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		document.addEventListener("keydown", handleKey);
		return () => document.removeEventListener("keydown", handleKey);
	}, [onClose]);

	return (
		<div
			ref={overlayRef}
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
			onClick={(e) => {
				if (e.target === e.currentTarget) onClose();
			}}
		>
			<div className="w-[420px] overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-2xl">
				{/* Header */}
				<div className="border-b border-[var(--border-subtle)] px-5 pb-3 pt-4">
					<div className="text-[14px] font-semibold text-[var(--text)]">Submit Review</div>
					<div className="mt-0.5 text-[11px] text-[var(--text-quaternary)]">
						{prCtx.title} · #{prCtx.number}
					</div>
				</div>

				{/* Pending actions summary */}
				<div className="border-b border-[var(--border-subtle)] px-5 py-3">
					{aiThreads.length > 0 && (
						<div className="mb-1.5 flex items-center gap-2">
							<span className="text-[11px] text-[var(--text-tertiary)]">
								{aiThreads.length} pending comment
								{aiThreads.length !== 1 ? "s" : ""} will be posted
							</span>
						</div>
					)}
					{pendingCount > 0 && (
						<div className="flex items-center gap-2">
							<span className="ai-badge">AI</span>
							<span className="text-[11px] text-[var(--text-tertiary)]">
								{pendingCount} AI suggestion{pendingCount !== 1 ? "s" : ""} not yet triaged
							</span>
						</div>
					)}
					{aiThreads.length === 0 && pendingCount === 0 && (
						<span className="text-[11px] text-[var(--text-quaternary)]">No pending comments</span>
					)}
				</div>

				{/* Result feedback */}
				{result && (
					<div
						className={`px-5 py-2 text-[10px] ${result.failed > 0 ? "bg-red-900/20 text-red-400" : "bg-green-900/20 text-green-400"}`}
					>
						<div>
							{result.posted} comment{result.posted !== 1 ? "s" : ""} posted.
							{result.failed > 0 && ` ${result.failed} failed.`}
						</div>
						{result.errors.length > 0 && (
							<div className="mt-1 max-h-[60px] overflow-y-auto font-mono">
								{result.errors.map((e, i) => (
									<div key={i}>{e}</div>
								))}
							</div>
						)}
					</div>
				)}

				{/* Body */}
				<div className="px-5 py-3">
					<textarea
						value={body}
						onChange={(e) => setBody(e.target.value)}
						placeholder="Leave a comment (optional)"
						rows={3}
						className="w-full resize-none rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-2 text-[12px] text-[var(--text-secondary)] placeholder-[var(--text-quaternary)] outline-none focus:border-[var(--accent)]"
					/>
				</div>

				{/* Verdict buttons */}
				<div className="flex gap-2 px-5 pb-4">
					<button
						type="button"
						disabled={isSubmitting}
						onClick={() => handleSubmit("COMMENT")}
						className="flex-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] py-2 text-[11px] font-medium text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-overlay)] disabled:opacity-50"
					>
						Comment
					</button>
					<button
						type="button"
						disabled={isSubmitting}
						onClick={() => handleSubmit("APPROVE")}
						className="flex-1 rounded-md border border-[rgba(48,209,88,0.15)] bg-[rgba(48,209,88,0.12)] py-2 text-[11px] font-semibold text-[#30d158] transition-colors hover:bg-[rgba(48,209,88,0.2)] disabled:opacity-50"
					>
						Approve
					</button>
					<button
						type="button"
						disabled={isSubmitting}
						onClick={() => handleSubmit("REQUEST_CHANGES")}
						className="flex-1 rounded-md border border-[rgba(255,69,58,0.12)] bg-[rgba(255,69,58,0.1)] py-2 text-[11px] font-medium text-[#ff453a] transition-colors hover:bg-[rgba(255,69,58,0.15)] disabled:opacity-50"
					>
						Request Changes
					</button>
				</div>
			</div>
		</div>
	);
}
