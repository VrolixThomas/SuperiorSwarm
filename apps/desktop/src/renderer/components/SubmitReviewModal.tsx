import type { AIDraftThread, GitHubPRContext } from "../../shared/github-types";

interface SubmitReviewModalProps {
	prCtx: GitHubPRContext;
	aiThreads: AIDraftThread[];
	pendingCount: number;
	headCommitOid: string;
	onClose: () => void;
	onSubmitted: () => void;
}

export function SubmitReviewModal(_props: SubmitReviewModalProps) {
	return null;
}
