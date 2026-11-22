/** Compact confirmed facts; omitted fields are unknown, never negative evidence. */
export interface PRActivityFacts {
	accountId?: string;
	authorAccountId?: string;
	viewerIsReviewer?: boolean;
	viewerReviewToken?: string;
	viewerReviewHead?: string;
	viewerReviewState?: string;
	state?: "open" | "closed" | "merged" | "declined";
	headSha?: string;
	isDraft?: boolean;
	reviewRequested?: boolean;
	reviewToken?: string;
	commentToken?: string;
}

export function prIdentity(provider: string, owner: string, repo: string, number: number): string {
	return `${provider}:${owner}/${repo}#${number}`;
}

export interface GitHubCompactPR {
	author?: { databaseId?: number };
	headRefName?: string;
	baseRefName?: string;
	headRefOid?: string;
	isDraft?: boolean;
	state?: string;
	reviewRequests?: {
		nodes: {
			requestedReviewer?: {
				login?: string;
				slug?: string;
				organization?: { login: string };
			} | null;
		}[];
		pageInfo: { hasNextPage: boolean };
	};
	reviews?: {
		totalCount: number;
		nodes: {
			id: string;
			state: string;
			submittedAt: string | null;
			author?: { login: string };
			commit?: { oid: string };
		}[];
	};
	comments?: { totalCount: number; nodes: { id: string; updatedAt: string }[] };
}

export function githubActivity(
	raw: GitHubCompactPR,
	login: string | undefined,
	teams: string[] | undefined
): PRActivityFacts {
	const facts: PRActivityFacts = {};
	if (raw.author?.databaseId) facts.authorAccountId = String(raw.author.databaseId);
	if (raw.headRefOid) facts.headSha = raw.headRefOid;
	if (typeof raw.isDraft === "boolean") facts.isDraft = raw.isDraft;
	if (raw.state === "OPEN" || raw.state === "CLOSED" || raw.state === "MERGED")
		facts.state = raw.state.toLowerCase() as PRActivityFacts["state"];
	if (raw.reviewRequests) {
		const matches = raw.reviewRequests.nodes.some(
			({ requestedReviewer: r }) =>
				r &&
				((login && r.login === login) ||
					(r.slug && r.organization && teams?.includes(`${r.organization.login}/${r.slug}`)))
		);
		if (matches) {
			facts.reviewRequested = true;
			facts.viewerIsReviewer = true;
		} else if (
			login &&
			teams &&
			raw.reviewRequests.pageInfo?.hasNextPage === false &&
			raw.reviewRequests.nodes.every(
				({ requestedReviewer: r }) => r && (r.login || (r.slug && r.organization))
			)
		)
			facts.reviewRequested = false;
	}
	// Counts plus newest IDs detect submissions even when counts remain unchanged.
	// This bounded observation does not cover edits to older comments/reviews or inline threads.
	if (raw.reviews) {
		facts.reviewToken = JSON.stringify(raw.reviews);
		const own = raw.reviews.nodes
			.filter((r) => r.author?.login === login && r.submittedAt && r.state !== "PENDING")
			.sort((a, b) => Date.parse(b.submittedAt ?? "") - Date.parse(a.submittedAt ?? ""))[0];
		if (own?.commit?.oid) {
			facts.viewerReviewHead = own.commit.oid;
			facts.viewerReviewState = own.state;
			facts.viewerIsReviewer = true;
		}
	}
	if (raw.comments) facts.commentToken = JSON.stringify(raw.comments);
	return facts;
}

export interface BitbucketCompactPR {
	author?: { account_id?: string; display_name?: string };
	state?: string;
	source?: { commit?: { hash?: string } };
	draft?: boolean;
	reviewers?: { account_id?: string }[];
	participants?: {
		user?: { account_id?: string };
		state?: string | null;
		approved?: boolean;
		participated_on?: string;
	}[];
	comment_count?: number;
}

export function bitbucketActivity(
	raw: BitbucketCompactPR,
	accountId: string | undefined
): PRActivityFacts {
	const facts: PRActivityFacts = {};
	if (accountId) facts.accountId = accountId;
	if (raw.author?.account_id) facts.authorAccountId = raw.author.account_id;
	if (raw.source?.commit?.hash) facts.headSha = raw.source.commit.hash;
	if (["OPEN", "MERGED", "DECLINED", "CLOSED", "SUPERSEDED"].includes(raw.state ?? ""))
		facts.state =
			raw.state === "SUPERSEDED"
				? "closed"
				: (raw.state?.toLowerCase() as PRActivityFacts["state"]);
	if (typeof raw.draft === "boolean") facts.isDraft = raw.draft;
	if (accountId && raw.participants) {
		const own = raw.participants.find((p) => p.user?.account_id === accountId);
		if (own?.state) {
			facts.viewerReviewState = own.state;
			facts.viewerReviewToken = JSON.stringify([own.state, own.approved, own.participated_on]);
		}
	}
	if (accountId && raw.reviewers) {
		facts.viewerIsReviewer = raw.reviewers.some((r) => r.account_id === accountId);
		if (!raw.reviewers.some((r) => r.account_id === accountId)) {
			if (raw.reviewers.every((r) => r.account_id)) facts.reviewRequested = false;
		} else if (raw.participants?.every((p) => p.user?.account_id)) {
			const participant = raw.participants.find((p) => p.user?.account_id === accountId);
			if (!participant || participant.state === null || participant.state === "")
				facts.reviewRequested = participant?.approved !== true;
			else if (
				participant.state === "approved" ||
				participant.state === "changes_requested" ||
				participant.approved === true
			)
				facts.reviewRequested = false;
		}
	}
	if (raw.participants?.every((p) => p.user?.account_id && p.state !== undefined))
		facts.reviewToken = JSON.stringify(
			raw.participants
				.map((p) => [p.user?.account_id, p.state, p.approved, p.participated_on])
				.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
		);
	// Count-only coverage: additions/deletions, not edits or thread resolution.
	if (typeof raw.comment_count === "number") facts.commentToken = String(raw.comment_count);
	return facts;
}
