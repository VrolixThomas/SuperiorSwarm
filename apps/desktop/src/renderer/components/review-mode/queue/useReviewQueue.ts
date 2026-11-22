import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PRContext } from "../../../../shared/github-types";
import { openPRReview, withReviewOpeningDeadline } from "../../../lib/open-pr-review";
import {
	type ReviewQueuePR,
	buildReviewQueue,
	nextPr,
	prevPr,
	reviewQueueKey,
} from "../../../lib/review-queue";
import { trpc } from "../../../trpc/client";

export function useReviewQueue(currentPr: PRContext) {
	const githubStatus = trpc.github.getStatus.useQuery(undefined, { staleTime: 30_000 });
	const bitbucketStatus = trpc.atlassian.getStatus.useQuery(undefined, { staleTime: 30_000 });
	const github = trpc.github.getMyPRs.useQuery(undefined, {
		enabled: githubStatus.data?.connected === true,
		staleTime: 30_000,
	});
	const bitbucket = trpc.atlassian.getReviewRequests.useQuery(undefined, {
		enabled: bitbucketStatus.data?.bitbucket.connected === true,
		staleTime: 30_000,
	});
	const cached = trpc.prPoller.getCachedPRs.useQuery(undefined, {
		staleTime: 10_000,
		refetchInterval: 30_000,
	});
	const utils = trpc.useUtils();
	const mutation = trpc.workspaces.getOrCreateReview.useMutation();
	const [openingKey, setOpeningKey] = useState<string | null>(null);
	const openingRef = useRef<string | null>(null);
	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
			openingRef.current = null;
		};
	}, []);
	const [openError, setOpenError] = useState<string | null>(null);
	const queue = useMemo(
		() => buildReviewQueue({ github: github.data, bitbucket: bitbucket.data, cached: cached.data }),
		[github.data, bitbucket.data, cached.data]
	);
	const currentKey = reviewQueueKey(currentPr);
	const openPR = useCallback(
		async (pr: ReviewQueuePR) => {
			if (openingRef.current) return false;
			openingRef.current = pr.key;
			setOpeningKey(pr.key);
			setOpenError(null);
			try {
				await withReviewOpeningDeadline(async (requestIsCurrent) => {
					const isCurrent = () =>
						mounted.current && openingRef.current === pr.key && requestIsCurrent();
					const projects = await utils.projects.getByRepo.fetch({ owner: pr.owner, repo: pr.repo });
					if (!isCurrent()) throw new Error("PR opening request is no longer active");
					const matching = projects.filter(
						(project) =>
							!project.remoteHost ||
							(pr.provider === "bitbucket"
								? project.remoteHost.includes("bitbucket")
								: !project.remoteHost.includes("bitbucket"))
					);
					const project =
						matching.find((candidate) => candidate.id === pr.projectId) ??
						(matching.length === 1 ? matching[0] : undefined);
					if (!project)
						throw new Error(
							`Repository ${pr.owner}/${pr.repo} must be linked to a ${pr.provider === "github" ? "GitHub" : "Bitbucket"} project before reviewing this PR.`
						);
					await openPRReview(
						{
							projectId: project.id,
							prCtx: {
								provider: pr.provider,
								owner: pr.owner,
								repo: pr.repo,
								number: pr.number,
								title: pr.title,
								sourceBranch: pr.sourceBranch,
								targetBranch: pr.targetBranch ?? project.defaultBranch ?? "main",
								repoPath: project.repoPath,
							},
						},
						mutation.mutateAsync,
						{ isCurrent }
					);
				});
				return true;
			} catch (error) {
				if (mounted.current)
					setOpenError(error instanceof Error ? error.message : "Could not open pull request.");
				return false;
			} finally {
				openingRef.current = null;
				if (mounted.current) setOpeningKey(null);
			}
		},
		[mutation.mutateAsync, utils]
	);
	return {
		queue,
		currentKey,
		next: nextPr(queue, currentKey),
		previous: prevPr(queue, currentKey),
		openPR,
		openingKey,
		error:
			openError ??
			github.error?.message ??
			bitbucket.error?.message ??
			cached.error?.message ??
			null,
		refresh: async () => {
			await Promise.all([
				cached.refetch(),
				githubStatus.data?.connected ? github.refetch() : Promise.resolve(),
				bitbucketStatus.data?.bitbucket.connected ? bitbucket.refetch() : Promise.resolve(),
				utils.reviewPath.status.invalidate(),
			]);
		},
		isLoading: cached.isLoading || github.isLoading || bitbucket.isLoading,
	};
}
