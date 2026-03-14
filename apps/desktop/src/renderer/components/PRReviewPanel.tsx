// apps/desktop/src/renderer/components/PRReviewPanel.tsx
import { useState } from "react";
import { detectLanguage } from "../../shared/diff-types";
import type { AIDraftThread, GitHubPRContext, GitHubPRDetails } from "../../shared/github-types";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";
import { CommentOverview } from "./CommentOverview";

// ── CI State icon ─────────────────────────────────────────────────────────────

function CiIcon({ state }: { state: GitHubPRDetails["ciState"] }) {
	if (!state) return null;
	if (state === "SUCCESS") return <span className="text-[var(--term-green)]">✓</span>;
	if (state === "FAILURE") return <span className="text-[var(--term-red)]">✗</span>;
	return <span className="text-yellow-400">●</span>;
}

// ── Zone 1: PR Header ─────────────────────────────────────────────────────────

function PRHeader({ details, prCtx }: { details: GitHubPRDetails; prCtx: GitHubPRContext }) {
	const [expanded, setExpanded] = useState(false);

	const decisionColor = {
		APPROVED: "text-green-400",
		CHANGES_REQUESTED: "text-red-400",
		REVIEW_REQUIRED: "text-yellow-400",
	};

	return (
		<div className="border-b border-[var(--border-subtle)] px-3 py-2">
			{/* Title row */}
			<button
				type="button"
				onClick={() => setExpanded((v) => !v)}
				className="flex w-full items-start gap-2 text-left"
			>
				<span className="flex-1 text-[12px] font-medium text-[var(--text-secondary)] leading-snug">
					{details.title}
				</span>
				<span className="shrink-0 text-[10px] text-[var(--text-quaternary)] mt-0.5">
					#{prCtx.number}
				</span>
			</button>

			{/* Badges row */}
			<div className="mt-1 flex items-center gap-2">
				{details.isDraft && (
					<span className="text-[10px] text-[var(--text-quaternary)]">Draft</span>
				)}
				{details.reviewDecision && (
					<span
						className={`text-[10px] font-medium ${decisionColor[details.reviewDecision] ?? ""}`}
					>
						{details.reviewDecision.replace("_", " ")}
					</span>
				)}
				<div className="flex items-center gap-1 text-[11px]">
					<CiIcon state={details.ciState} />
				</div>
			</div>

			{/* Expanded: reviewers + checks */}
			{expanded && (
				<div className="mt-2 flex flex-col gap-1.5">
					{details.reviewers.length > 0 && (
						<div className="flex flex-col gap-0.5">
							<div className="text-[10px] uppercase tracking-wide text-[var(--text-quaternary)]">
								Reviewers
							</div>
							{details.reviewers.map((r) => (
								<div
									key={r.login}
									className="flex items-center gap-1.5 text-[11px] text-[var(--text-tertiary)]"
								>
									<span>{r.login}</span>
									{r.decision === "APPROVED" && <span className="text-green-400">✓</span>}
									{r.decision === "CHANGES_REQUESTED" && <span className="text-red-400">✗</span>}
								</div>
							))}
						</div>
					)}
					{details.checks.length > 0 && (
						<div className="flex flex-col gap-0.5">
							<div className="text-[10px] uppercase tracking-wide text-[var(--text-quaternary)]">
								Checks
							</div>
							{details.checks.map((c) => (
								<div
									key={c.name}
									className="flex items-center gap-1.5 text-[11px] text-[var(--text-tertiary)]"
								>
									{c.conclusion === "SUCCESS" ? (
										<span className="text-green-400">✓</span>
									) : c.conclusion === "FAILURE" ? (
										<span className="text-red-400">✗</span>
									) : (
										<span className="text-yellow-400">●</span>
									)}
									<span className="truncate">{c.name}</span>
								</div>
							))}
						</div>
					)}
				</div>
			)}
		</div>
	);
}

// ── Zone 2: File list ─────────────────────────────────────────────────────────

function FileList({
	details,
	prCtx,
	viewedFiles,
	onToggleViewed,
	aiThreads,
}: {
	details: GitHubPRDetails;
	prCtx: GitHubPRContext;
	viewedFiles: Set<string>;
	onToggleViewed: (path: string, viewed: boolean) => void;
	aiThreads: AIDraftThread[];
}) {
	const openPRReviewFile = useTabStore((s) => s.openPRReviewFile);
	const activeWorkspaceId = useTabStore((s) => s.activeWorkspaceId);

	const threadCountByFile = new Map<string, number>();
	for (const t of details.reviewThreads) {
		if (!t.isResolved) {
			threadCountByFile.set(t.path, (threadCountByFile.get(t.path) ?? 0) + 1);
		}
	}
	for (const t of aiThreads) {
		if (t.status === "pending") {
			threadCountByFile.set(t.path, (threadCountByFile.get(t.path) ?? 0) + 1);
		}
	}

	const viewed = viewedFiles.size;
	const total = details.files.length;

	return (
		<div className="flex flex-1 flex-col overflow-hidden">
			{/* Progress bar */}
			<div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--border-subtle)]">
				<div className="flex-1 h-1 rounded-full bg-[var(--bg-elevated)] overflow-hidden">
					<div
						className="h-full rounded-full bg-[var(--accent)] transition-all duration-200"
						style={{ width: total > 0 ? `${(viewed / total) * 100}%` : "0%" }}
					/>
				</div>
				<span className="shrink-0 text-[10px] text-[var(--text-quaternary)]">
					{viewed}/{total}
				</span>
			</div>

			{/* File rows */}
			<div className="flex-1 overflow-y-auto py-1">
				{details.files.map((file) => {
					const isViewed = viewedFiles.has(file.path);
					const commentCount = threadCountByFile.get(file.path) ?? 0;
					const filename = file.path.split("/").pop() ?? file.path;
					const dir = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "";

					return (
						<div key={file.path} className="group flex items-center gap-1.5 px-2 py-0.5">
							{/* Viewed checkbox */}
							<input
								type="checkbox"
								checked={isViewed}
								onChange={(e) => onToggleViewed(file.path, e.target.checked)}
								onClick={(e) => e.stopPropagation()}
								className="shrink-0 h-3 w-3 rounded accent-[var(--accent)]"
							/>

							{/* File name button */}
							<button
								type="button"
								onClick={() => {
									if (!activeWorkspaceId) return;
									openPRReviewFile(activeWorkspaceId, prCtx, file.path, detectLanguage(file.path));
								}}
								className={`flex min-w-0 flex-1 items-center gap-1.5 rounded-[4px] px-1.5 py-0.5 text-left text-[11px] transition-colors hover:bg-[var(--bg-elevated)] ${
									isViewed
										? "text-[var(--text-quaternary)] line-through"
										: "text-[var(--text-secondary)]"
								}`}
								title={file.path}
							>
								<span className="truncate font-mono">{filename}</span>
								{dir && (
									<span className="shrink-0 truncate text-[10px] text-[var(--text-quaternary)]">
										{dir}
									</span>
								)}
							</button>

							{/* Stats */}
							<span className="shrink-0 text-[10px] text-[var(--term-green)]">
								+{file.additions}
							</span>
							<span className="shrink-0 text-[10px] text-[var(--term-red)]">-{file.deletions}</span>

							{/* Unresolved comment count */}
							{commentCount > 0 && (
								<span className="shrink-0 text-[10px] font-medium text-yellow-400">
									{commentCount}
								</span>
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
}

// ── Zone 3: Submit review ─────────────────────────────────────────────────────

function SubmitReview({
	prCtx,
	aiThreads,
	headCommitOid,
	onSubmitted,
}: {
	prCtx: GitHubPRContext;
	aiThreads: AIDraftThread[];
	headCommitOid: string;
	onSubmitted: () => void;
}) {
	const [body, setBody] = useState("");
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [submitResult, setSubmitResult] = useState<{
		posted: number;
		failed: number;
	} | null>(null);
	const utils = trpc.useUtils();

	const createThread = trpc.github.createReviewThread.useMutation();
	const updateDraftComment = trpc.aiReview.updateDraftComment.useMutation();

	const submit = trpc.github.submitReview.useMutation({
		onSuccess: () => {
			setBody("");
			utils.github.getPRDetails.invalidate({
				owner: prCtx.owner,
				repo: prCtx.repo,
				number: prCtx.number,
			});
			utils.github.getMyPRs.invalidate();
			onSubmitted();
		},
	});

	const handleSubmit = async (verdict: "COMMENT" | "APPROVE" | "REQUEST_CHANGES") => {
		setIsSubmitting(true);
		setSubmitResult(null);

		// Post accepted AI comments as review threads
		const approvedComments = aiThreads.filter((t) => t.status === "approved");
		let posted = 0;
		let failed = 0;

		for (const comment of approvedComments) {
			if (comment.line == null) continue;
			try {
				await createThread.mutateAsync({
					owner: prCtx.owner,
					repo: prCtx.repo,
					prNumber: prCtx.number,
					body: comment.userEdit ?? comment.body,
					commitId: headCommitOid,
					path: comment.path,
					line: comment.line,
					side: comment.diffSide,
				});
				await updateDraftComment.mutateAsync({
					commentId: comment.draftCommentId,
					status: "submitted",
				});
				posted++;
			} catch {
				failed++;
			}
		}

		if (approvedComments.length > 0) {
			setSubmitResult({ posted, failed });
		}

		// Submit the review verdict
		submit.mutate({
			owner: prCtx.owner,
			repo: prCtx.repo,
			prNumber: prCtx.number,
			verdict,
			body,
		});

		setIsSubmitting(false);
	};

	const acceptedCount = aiThreads.filter((t) => t.status === "approved").length;

	return (
		<div className="shrink-0 border-t border-[var(--border-subtle)] px-3 py-2">
			<textarea
				value={body}
				onChange={(e) => setBody(e.target.value)}
				placeholder="Review comment (optional)"
				rows={3}
				className="w-full resize-none rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-1.5 text-[11px] text-[var(--text-secondary)] placeholder-[var(--text-quaternary)] outline-none focus:border-[var(--accent)]"
			/>
			{acceptedCount > 0 && (
				<div className="mt-1 text-[10px] text-[var(--text-quaternary)]">
					{acceptedCount} accepted AI comment{acceptedCount !== 1 ? "s" : ""} will be posted
					to GitHub when you submit.
				</div>
			)}
			<div className="mt-1.5 flex gap-1.5">
				{(["COMMENT", "APPROVE", "REQUEST_CHANGES"] as const).map((verdict) => (
					<button
						key={verdict}
						type="button"
						disabled={submit.isPending || isSubmitting}
						onClick={() => handleSubmit(verdict)}
						className={`flex-1 rounded-[4px] py-1 text-[10px] font-medium transition-colors disabled:opacity-50 ${
							verdict === "APPROVE"
								? "bg-green-900/40 text-green-400 hover:bg-green-900/60"
								: verdict === "REQUEST_CHANGES"
									? "bg-red-900/40 text-red-400 hover:bg-red-900/60"
									: "bg-[var(--bg-elevated)] text-[var(--text-tertiary)] hover:bg-[var(--bg-overlay)]"
						}`}
					>
						{verdict === "APPROVE"
							? "Approve"
							: verdict === "REQUEST_CHANGES"
								? "Request Changes"
								: "Comment"}
					</button>
				))}
			</div>
			{submitResult && (
				<div
					className={`mt-1.5 rounded-[4px] px-2 py-1 text-[10px] ${
						submitResult.failed > 0
							? "bg-red-900/20 text-red-400"
							: "bg-green-900/20 text-green-400"
					}`}
				>
					{submitResult.posted} AI comment{submitResult.posted !== 1 ? "s" : ""} posted.
					{submitResult.failed > 0 && ` ${submitResult.failed} failed.`}
				</div>
			)}
		</div>
	);
}

// ── Root ──────────────────────────────────────────────────────────────────────

export function PRReviewPanel({ prCtx }: { prCtx: GitHubPRContext }) {
	const utils = trpc.useUtils();
	const { data: details, isLoading } = trpc.github.getPRDetails.useQuery(
		{ owner: prCtx.owner, repo: prCtx.repo, number: prCtx.number },
		{ staleTime: 30_000 }
	);

	const { data: viewedFilesList } = trpc.github.getViewedFiles.useQuery(
		{ owner: prCtx.owner, repo: prCtx.repo, number: prCtx.number },
		{ staleTime: 30_000 }
	);

	const viewedFiles = new Set(viewedFilesList ?? []);

	const markViewed = trpc.github.markFileViewed.useMutation({
		onSuccess: () =>
			utils.github.getViewedFiles.invalidate({
				owner: prCtx.owner,
				repo: prCtx.repo,
				number: prCtx.number,
			}),
	});

	// ── AI review draft queries ──────────────────────────────────────────────
	const prIdentifier = `${prCtx.owner}/${prCtx.repo}#${prCtx.number}`;
	const reviewDraftsQuery = trpc.aiReview.getReviewDrafts.useQuery(undefined, {
		staleTime: 5_000,
	});
	const matchingDraft = reviewDraftsQuery.data?.find((d) => d.prIdentifier === prIdentifier);
	const aiDraftQuery = trpc.aiReview.getReviewDraft.useQuery(
		{ draftId: matchingDraft?.id ?? "" },
		{ enabled: !!matchingDraft?.id }
	);

	const aiThreads: AIDraftThread[] = (aiDraftQuery.data?.comments ?? [])
		.filter((c) => c.status === "pending" || c.status === "edited")
		.map((c) => ({
			id: `ai-${c.id}`,
			isAIDraft: true as const,
			draftCommentId: c.id,
			path: c.filePath,
			line: c.lineNumber,
			diffSide: (c.side as "LEFT" | "RIGHT") ?? "RIGHT",
			body: c.body,
			status: c.status as "pending" | "approved" | "rejected" | "edited",
			userEdit: c.userEdit ?? null,
			createdAt:
				typeof c.createdAt === "string" ? c.createdAt : new Date(c.createdAt).toISOString(),
		}));

	if (isLoading || !details) {
		return (
			<div className="flex flex-col gap-2 p-3">
				{[1, 2, 3, 4].map((i) => (
					<div key={i} className="h-3 w-full animate-pulse rounded bg-[var(--bg-elevated)]" />
				))}
			</div>
		);
	}

	return (
		<div className="flex h-full flex-col overflow-hidden">
			<PRHeader details={details} prCtx={prCtx} />
			<FileList
				details={details}
				prCtx={prCtx}
				viewedFiles={viewedFiles}
				aiThreads={aiThreads}
				onToggleViewed={(path, viewed) =>
					markViewed.mutate({
						owner: prCtx.owner,
						repo: prCtx.repo,
						number: prCtx.number,
						filePath: path,
						viewed,
					})
				}
			/>
			{details && <CommentOverview details={details} prCtx={prCtx} aiThreads={aiThreads} />}
			<SubmitReview
				prCtx={prCtx}
				aiThreads={aiThreads}
				headCommitOid={details?.headCommitOid ?? ""}
				onSubmitted={() => {
					utils.github.getPRDetails.invalidate({
						owner: prCtx.owner,
						repo: prCtx.repo,
						number: prCtx.number,
					});
					aiDraftQuery.refetch();
				}}
			/>
		</div>
	);
}
