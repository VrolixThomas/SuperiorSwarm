import type { ReviewerIdentityScope } from "../../shared/reviewer-identity";
import { atlassianFetch, getAuth as getAtlassianAuth } from "../atlassian/auth";
import { BITBUCKET_API_BASE } from "../atlassian/constants";
import { getAuth as getGitHubAuth, githubFetch } from "../github/auth";
import { lookupCurrentReviewer } from "./reviewer-identity-core";

export function getGitHubCurrentReviewer(scope: ReviewerIdentityScope) {
	return lookupCurrentReviewer("github", scope, {
		getAuth: getGitHubAuth,
		fetchUser: () => githubFetch("/user"),
	});
}

export function getBitbucketCurrentReviewer(scope: ReviewerIdentityScope) {
	return lookupCurrentReviewer("bitbucket", scope, {
		getAuth: () => getAtlassianAuth("bitbucket"),
		fetchUser: () => atlassianFetch("bitbucket", `${BITBUCKET_API_BASE}/user`),
	});
}
