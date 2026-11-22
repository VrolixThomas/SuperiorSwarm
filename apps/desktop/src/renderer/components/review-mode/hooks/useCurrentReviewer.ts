import type { PRContext } from "../../../../shared/github-types";
import { trpc } from "../../../trpc/client";

/** Suppress stale account identity during reconnect/refetch; never infer login from display name. */
export function useCurrentReviewer(pr: PRContext, enabled = true) {
	const github = trpc.github.getStatus.useQuery(undefined, {
		enabled: enabled && pr.provider === "github",
		staleTime: 0,
	});
	const bitbucket = trpc.atlassian.getStatus.useQuery(undefined, {
		enabled: enabled && pr.provider === "bitbucket",
		staleTime: 0,
	});
	const auth = pr.provider === "github" ? github.data : bitbucket.data?.bitbucket;
	const refreshing = pr.provider === "github" ? github.isFetching : bitbucket.isFetching;
	const accountId = auth?.connected ? auth.accountId : null;
	const host = pr.provider === "github" ? "github.com" : "bitbucket.org";
	const scope = { host, owner: pr.owner, repo: pr.repo, accountId };
	const ghIdentity = trpc.github.getCurrentReviewer.useQuery(scope, {
		enabled: enabled && pr.provider === "github" && !!accountId && !refreshing,
		staleTime: 0,
	});
	const bbIdentity = trpc.atlassian.getCurrentReviewer.useQuery(scope, {
		enabled: enabled && pr.provider === "bitbucket" && !!accountId && !refreshing,
		staleTime: 0,
	});
	const query = pr.provider === "github" ? ghIdentity : bbIdentity;
	const result = query.data;
	return enabled &&
		!refreshing &&
		!query.isFetching &&
		!query.isError &&
		auth?.connected &&
		result?.status === "available" &&
		result.accountId === accountId &&
		result.provider === pr.provider &&
		result.owner === pr.owner &&
		result.repo === pr.repo &&
		result.host === host
		? result.identity
		: undefined;
}
