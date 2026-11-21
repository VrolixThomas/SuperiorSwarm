import { useCallback, useMemo, useState } from "react";
import type { GitHubPRDetails, PRContext } from "../../../../shared/github-types";
import type {
	ReviewPathIdentity,
	ReviewPathLaunchResult,
} from "../../../../shared/review-path-runtime";
import { attachReadingPathTerminal } from "../../../lib/review-connected-terminal";
import { useReviewPath } from "../../../lib/review-path-source";
import { trpc } from "../../../trpc/client";
import { useAskAgent } from "../panel/useAskAgent";
import { useCurrentReviewer } from "./useCurrentReviewer";

export function useReviewConnections(
	workspaceId: string,
	prCtx: PRContext,
	details: GitHubPRDetails | undefined,
	fixture: boolean
) {
	const [attachmentError, setAttachmentError] = useState<string>();
	const { mutateAsync: attach } = trpc.workspaces.attachTerminal.useMutation();
	const onLaunch = useCallback(
		(launch: ReviewPathLaunchResult) => {
			setAttachmentError(undefined);
			void attachReadingPathTerminal(workspaceId, launch, attach)
				.then((ok) => {
					if (!ok) setAttachmentError("The agent terminal did not match this review workspace.");
				})
				.catch((error) =>
					setAttachmentError(
						error instanceof Error ? error.message : "Could not attach the agent terminal."
					)
				);
		},
		[workspaceId, attach]
	);
	const identity = useMemo<ReviewPathIdentity | undefined>(
		() =>
			details?.headCommitOid && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(details.headCommitOid)
				? {
						workspaceId,
						provider: prCtx.provider,
						owner: prCtx.owner,
						repo: prCtx.repo,
						prNumber: prCtx.number,
						headSha: details.headCommitOid,
					}
				: undefined,
		[workspaceId, prCtx.provider, prCtx.owner, prCtx.repo, prCtx.number, details?.headCommitOid]
	);
	const source = useReviewPath(prCtx, details, { fixture, identity, onLaunch });
	const askAgent = useAskAgent(prCtx, { fixture, identity, onLaunch });
	const reviewer = useCurrentReviewer(prCtx, !fixture);
	return { source, askAgent, reviewer, attachmentError };
}
