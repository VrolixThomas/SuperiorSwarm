import { useCallback, useMemo } from "react";
import type { GitHubPRDetails, PRContext, UnifiedThread } from "../../../../shared/github-types";
import { formatPrIdentifier } from "../../../../shared/pr-identifier";
import {
	prReviewSessionKey,
	usePRReviewSessionStore,
} from "../../../stores/pr-review-session-store";
import { useReviewModeStore } from "../../../stores/review-mode-store";
import { trpc } from "../../../trpc/client";
import { FileSection } from "./FileSection";
import { ThreadSection } from "./ThreadSection";

interface ReviewNavigatorProps {
	workspaceId: string;
	prCtx: PRContext;
	details: GitHubPRDetails;
	threads: UnifiedThread[];
	commentCountByFile: Map<string, number>;
}

type CIState = NonNullable<GitHubPRDetails["ciState"]>;
type ReviewDecision = NonNullable<GitHubPRDetails["reviewDecision"]>;

const CI_META: Record<CIState, { label: string; dotClassName: string }> = {
	SUCCESS: { label: "CI passed", dotClassName: "bg-[var(--color-success)]" },
	FAILURE: { label: "CI failed", dotClassName: "bg-[var(--color-danger)]" },
	PENDING: { label: "CI pending", dotClassName: "bg-[var(--color-warning)]" },
	NEUTRAL: { label: "CI neutral", dotClassName: "bg-[var(--text-quaternary)]" },
};

const REVIEW_DECISION_META: Record<ReviewDecision, { label: string; className: string }> = {
	APPROVED: { label: "Approved", className: "text-[var(--color-success)]" },
	CHANGES_REQUESTED: { label: "Changes requested", className: "text-[var(--color-danger)]" },
	REVIEW_REQUIRED: { label: "Review required", className: "text-[var(--color-warning)]" },
};

export function ReviewNavigator({
	workspaceId,
	prCtx,
	details,
	threads,
	commentCountByFile,
}: ReviewNavigatorProps) {
	const utils = trpc.useUtils();
	const isGitHubPR = prCtx.provider === "github";
	const sessionKey = prReviewSessionKey(workspaceId, formatPrIdentifier(prCtx));
	const activeFilePath = usePRReviewSessionStore(
		(s) => s.sessions.get(sessionKey)?.activeFilePath ?? null
	);
	const selectFile = usePRReviewSessionStore((s) => s.selectFile);
	const setView = useReviewModeStore((s) => s.setView);

	const { data: viewedFilesList } = trpc.github.getViewedFiles.useQuery(
		{ owner: prCtx.owner, repo: prCtx.repo, number: prCtx.number },
		{ enabled: isGitHubPR, staleTime: 30_000 }
	);

	const markFileViewed = trpc.github.markFileViewed.useMutation({
		onSuccess: (_data, variables) =>
			utils.github.getViewedFiles.invalidate({
				owner: variables.owner,
				repo: variables.repo,
				number: variables.number,
			}),
	});

	const viewedFiles = useMemo(
		() => (isGitHubPR ? new Set(viewedFilesList ?? []) : new Set<string>()),
		[isGitHubPR, viewedFilesList]
	);

	const onSelectFile = useCallback(
		(path: string) => {
			selectFile(sessionKey, path);
			setView("changes");
		},
		[selectFile, sessionKey, setView]
	);

	const onToggleViewed = useCallback(
		(filePath: string, viewed: boolean) => {
			if (!isGitHubPR) return;
			markFileViewed.mutate({
				owner: prCtx.owner,
				repo: prCtx.repo,
				number: prCtx.number,
				filePath,
				viewed,
			});
		},
		[isGitHubPR, markFileViewed, prCtx.owner, prCtx.repo, prCtx.number]
	);

	const ciMeta = details.ciState ? CI_META[details.ciState] : null;
	const reviewDecisionMeta = details.reviewDecision
		? REVIEW_DECISION_META[details.reviewDecision]
		: null;

	return (
		<nav className="flex min-h-full flex-col">
			<div className="shrink-0 px-3 py-3">
				<div className="min-w-0 truncate text-[13px] font-medium text-[var(--text)]">
					{prCtx.owner}/{prCtx.repo}
				</div>

				<div className="mt-2 flex min-w-0 items-center gap-1.5">
					<span
						className="min-w-0 max-w-[118px] truncate rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--text-secondary)]"
						title={details.sourceBranch}
					>
						{details.sourceBranch}
					</span>
					<span className="shrink-0 font-mono text-[11px] text-[var(--text-quaternary)]">
						-&gt;
					</span>
					<span
						className="min-w-0 max-w-[118px] truncate rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--text-secondary)]"
						title={details.targetBranch}
					>
						{details.targetBranch}
					</span>
				</div>

				<div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
					<span className="min-w-0 truncate text-[var(--text-tertiary)]">by {details.author}</span>
					{ciMeta && (
						<span className="inline-flex items-center gap-1 text-[var(--text-tertiary)]">
							<span className={`size-1.5 rounded-full ${ciMeta.dotClassName}`} />
							<span>{ciMeta.label}</span>
						</span>
					)}
					{reviewDecisionMeta && (
						<span
							className={`rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[11px] font-medium ${reviewDecisionMeta.className}`}
						>
							{reviewDecisionMeta.label}
						</span>
					)}
				</div>
			</div>

			<FileSection
				files={details.files}
				viewedFiles={viewedFiles}
				commentCountByFile={commentCountByFile}
				activeFilePath={activeFilePath}
				onSelectFile={onSelectFile}
				onToggleViewed={onToggleViewed}
			/>

			<ThreadSection workspaceId={workspaceId} prCtx={prCtx} threads={threads} />
		</nav>
	);
}
