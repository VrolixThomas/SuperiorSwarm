import type {
	GitHubPRDetails,
	GitHubPREnriched,
	GitHubReviewThread,
	GitHubReviewer,
} from "../../shared/github-types";
import { atlassianFetch, getAuth } from "../atlassian/auth";
import {
	type BitbucketComment,
	type BitbucketPullRequest,
	createPRComment,
	getBitbucketPRComments,
	getBitbucketPRDetails,
	getBitbucketPRStatuses,
	getMyPullRequests,
	getPRState,
	getReviewRequests,
	replyToPRComment,
} from "../atlassian/bitbucket";
import { BITBUCKET_API_BASE } from "../atlassian/constants";
import type {
	CreateCommentParams,
	GitProvider,
	NormalizedComment,
	NormalizedPR,
	NormalizedPRFile,
	NormalizedReviewThread,
	PRState,
	ReplyParams,
	ResolveParams,
	SubmitReviewParams,
} from "./types";

// ── Pure mapping helpers (exported for testing) ───────────────────────────────

export function normalizeBBState(state: string): "open" | "closed" | "merged" | "declined" {
	switch (state?.toUpperCase()) {
		case "OPEN":
			return "open";
		case "MERGED":
			return "merged";
		case "DECLINED":
			return "declined";
		default:
			return "closed";
	}
}

export function mapBitbucketPR(
	pr: BitbucketPullRequest,
	role: "author" | "reviewer"
): NormalizedPR {
	return {
		id: pr.id,
		title: pr.title,
		state: normalizeBBState(pr.state),
		author: pr.author,
		webUrl: pr.webUrl,
		sourceBranch: pr.source?.branch?.name ?? "",
		targetBranch: pr.destination?.branch?.name ?? "",
		role,
		repoOwner: pr.workspace,
		repoName: pr.repoSlug,
		headCommitSha: pr.headCommitSha,
		activity: pr.activity,
	};
}

export function mapBitbucketComment(comment: BitbucketComment): NormalizedComment {
	return {
		id: String(comment.id),
		body: comment.body,
		author: comment.author,
		filePath: comment.filePath,
		lineNumber: comment.lineNumber,
		side: comment.diffSide ?? null,
		createdAt: comment.createdAt,
	};
}

/** A reply inherits only its proved root's location/resolution, never its own stale inline copy. */
function groupBitbucketComments(comments: BitbucketComment[]) {
	const byId = new Map(comments.map((comment) => [comment.id, comment]));
	const groups = new Map<number, BitbucketComment[]>();
	const conversationComments: GitHubPRDetails["conversationComments"] = [];
	const asComment = (comment: BitbucketComment) => ({
		id: String(comment.id),
		body: comment.body,
		author: comment.author,
		authorId: comment.authorId ?? null,
		authorAvatarUrl: "",
		createdAt: comment.createdAt,
	});
	for (const comment of comments) {
		let root: BitbucketComment | undefined = comment;
		const visited = new Set<number>();
		while (root?.parentId != null) {
			if (visited.has(root.id)) {
				root = undefined;
				break;
			}
			visited.add(root.id);
			root = byId.get(root.parentId);
		}
		if (!root?.filePath) {
			// Orphans/cycles have no proved thread anchor. Keep their text in the conversation.
			conversationComments.push(asComment(comment));
			continue;
		}
		const members = groups.get(root.id) ?? [];
		members.push(comment);
		groups.set(root.id, members);
	}
	const reviewThreads: GitHubReviewThread[] = [];
	for (const [rootId, members] of groups) {
		const root = byId.get(rootId);
		if (!root?.filePath) continue;
		reviewThreads.push({
			id: String(root.id),
			path: root.filePath,
			isResolved: root.isResolved ?? false,
			resolutionKnown: typeof root.isResolved === "boolean",
			line: root.isOutdated ? null : root.lineNumber,
			originalLine: root.originalLine,
			isOutdated: root.isOutdated,
			// File-level comments have no side; RIGHT is an inert legacy placeholder with line:null.
			diffSide: root.diffSide ?? "RIGHT",
			comments: [root, ...members.filter((comment) => comment.id !== root.id)].map(asComment),
		});
	}
	return { reviewThreads, conversationComments };
}

// ── Enrichment types ──────────────────────────────────────────────────────────

export interface BitbucketParticipant {
	user?: { display_name?: string } | null;
	role: string;
	state?: string | null;
}

export interface BitbucketStatus {
	state: string;
}

// ── Enrichment mapping helpers (exported for testing) ─────────────────────────

export function mapParticipantToReviewer(p: BitbucketParticipant): GitHubReviewer {
	let decision: GitHubReviewer["decision"];
	switch (p.state) {
		case "approved":
			decision = "APPROVED";
			break;
		case "changes_requested":
			decision = "CHANGES_REQUESTED";
			break;
		default:
			decision = "PENDING";
	}
	return {
		login: p.user?.display_name ?? "Unknown",
		avatarUrl: "",
		decision,
	};
}

export function aggregateCIState(
	statuses: BitbucketStatus[]
): "SUCCESS" | "FAILURE" | "PENDING" | "NEUTRAL" | null {
	if (statuses.length === 0) return null;
	if (statuses.some((s) => s.state === "FAILED" || s.state === "STOPPED")) return "FAILURE";
	if (statuses.some((s) => s.state === "INPROGRESS")) return "PENDING";
	if (statuses.every((s) => s.state === "SUCCESSFUL")) return "SUCCESS";
	return null;
}

export function deriveReviewDecision(
	reviewers: GitHubReviewer[]
): "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null {
	if (reviewers.length === 0) return "REVIEW_REQUIRED";
	if (reviewers.some((r) => r.decision === "CHANGES_REQUESTED")) return "CHANGES_REQUESTED";
	if (reviewers.some((r) => r.decision === "APPROVED")) return "APPROVED";
	return "REVIEW_REQUIRED";
}

/**
 * Dedup Bitbucket PRs by composite `workspace/repoSlug#id`.
 *
 * The previous implementation used `Set<number>` keyed on numeric `id` only,
 * which collapsed PR #1 from repoA with PR #1 from repoB. Whichever entry won
 * could flip between calls (depending on Bitbucket API result ordering with
 * `pagelen=50` and no pagination), causing the pr-poller flood we observed in
 * 2026-04-07 logs (see docs/superpowers/plans/2026-04-07-app-freeze-fix.md).
 *
 * Authored PRs are emitted before reviewing PRs; if a PR appears in both, the
 * authored role wins (matching the previous behaviour).
 */
export function dedupBitbucketPRs(
	authored: BitbucketPullRequest[],
	reviewing: BitbucketPullRequest[]
): NormalizedPR[] {
	const key = (pr: BitbucketPullRequest) => `${pr.workspace}/${pr.repoSlug}#${pr.id}`;
	const seen = new Set<string>();
	const results: NormalizedPR[] = [];

	for (const pr of authored) {
		const k = key(pr);
		if (seen.has(k)) continue;
		seen.add(k);
		results.push(mapBitbucketPR(pr, "author"));
	}

	for (const pr of reviewing) {
		const k = key(pr);
		if (seen.has(k)) continue;
		seen.add(k);
		results.push(mapBitbucketPR(pr, "reviewer"));
	}

	return results;
}

// ── BitbucketAdapter ──────────────────────────────────────────────────────────

export class BitbucketAdapter implements GitProvider {
	readonly name = "bitbucket" as const;
	// Cloud's PR comment endpoint accepts inline from/to/path, but no revision pin.
	// A separate head read cannot prevent a push racing the comment POST.
	readonly supportsPinnedInlineComments = false;

	isConnected(): boolean {
		return getAuth("bitbucket") !== null;
	}

	async getMyPRs(): Promise<NormalizedPR[]> {
		const [authored, reviewing] = await Promise.all([getMyPullRequests(), getReviewRequests()]);
		if (
			[...authored, ...reviewing].some(
				(pr) => !["OPEN", "CLOSED", "MERGED", "DECLINED", "SUPERSEDED"].includes(pr.state)
			)
		)
			throw new Error("Bitbucket listing contained an unknown PR state");
		return dedupBitbucketPRs(authored, reviewing);
	}

	async getPRState(owner: string, repo: string, prNumber: number): Promise<PRState> {
		const { headSha, state, activity } = await getPRState(owner, repo, prNumber);
		return { headSha, state: normalizeBBState(state), activity };
	}

	async getPRComments(owner: string, repo: string, prNumber: number): Promise<NormalizedComment[]> {
		const comments = await getBitbucketPRComments(owner, repo, prNumber);
		return comments.map(mapBitbucketComment);
	}

	async getPRCommentsIfChanged(
		owner: string,
		repo: string,
		prNumber: number,
		cacheKey?: string
	): Promise<
		{ changed: true; comments: NormalizedComment[]; cacheKey: string } | { changed: false }
	> {
		// Fetch PR metadata to check updated_on (lightweight — single object, no pagination)
		const res = await atlassianFetch(
			"bitbucket",
			`${BITBUCKET_API_BASE}/repositories/${owner}/${repo}/pullrequests/${prNumber}?fields=updated_on`
		);
		if (!res.ok) throw new Error(`Bitbucket PR metadata fetch failed: ${res.status}`);

		const data = (await res.json()) as { updated_on?: string };
		const updatedOn = data.updated_on;

		if (!updatedOn) {
			// Cannot determine freshness — fetch unconditionally
			const comments = await this.getPRComments(owner, repo, prNumber);
			return { changed: true, comments, cacheKey: "" };
		}

		if (cacheKey && updatedOn === cacheKey) {
			return { changed: false };
		}

		// Something changed — fetch full comment set
		const comments = await this.getPRComments(owner, repo, prNumber);
		return { changed: true, comments, cacheKey: updatedOn };
	}

	async createInlineComment(params: CreateCommentParams): Promise<{ id: string; nodeId?: string }> {
		if (params.filePath && params.commitId != null) {
			throw new Error("Bitbucket Cloud does not support revision-pinned inline comments");
		}
		const { id } = await createPRComment(
			params.owner,
			params.repo,
			params.prNumber,
			params.body,
			params.filePath,
			params.line,
			params.side
		);
		return { id: String(id) };
	}

	async replyToComment(params: ReplyParams): Promise<{ id: string }> {
		const { id } = await replyToPRComment(
			params.owner,
			params.repo,
			params.prNumber,
			Number(params.commentId),
			params.body
		);
		return { id: String(id) };
	}

	async resolveComment(params: ResolveParams): Promise<void> {
		const res = await atlassianFetch(
			"bitbucket",
			`${BITBUCKET_API_BASE}/repositories/${params.owner}/${params.repo}/pullrequests/${params.prNumber}/comments/${params.commentId}/resolve`,
			{ method: "POST" }
		);
		if (!res.ok && res.status !== 409) {
			throw new Error(`Bitbucket resolve comment failed: ${res.status}`);
		}
	}

	async unresolveComment(params: ResolveParams): Promise<void> {
		const res = await atlassianFetch(
			"bitbucket",
			`${BITBUCKET_API_BASE}/repositories/${params.owner}/${params.repo}/pullrequests/${params.prNumber}/comments/${params.commentId}/resolve`,
			{ method: "DELETE" }
		);
		if (!res.ok && res.status !== 409) {
			throw new Error(`Bitbucket unresolve comment failed: ${res.status}`);
		}
	}

	async submitReview(params: SubmitReviewParams): Promise<void> {
		const base = `${BITBUCKET_API_BASE}/repositories/${params.owner}/${params.repo}/pullrequests/${params.prNumber}`;

		if (params.body.trim()) {
			await createPRComment(params.owner, params.repo, params.prNumber, params.body.trim());
		}

		if (params.verdict === "APPROVE") {
			const res = await atlassianFetch("bitbucket", `${base}/approve`, { method: "POST" });
			// 409 = already approved, not an error
			if (!res.ok && res.status !== 409) {
				throw new Error(`Bitbucket approve failed: ${res.status}`);
			}
		} else if (params.verdict === "REQUEST_CHANGES") {
			const res = await atlassianFetch("bitbucket", `${base}/request-changes`, {
				method: "POST",
			});
			// 409 = already requested changes; silently no-ops if user is author
			if (!res.ok && res.status !== 409) {
				throw new Error(`Bitbucket request-changes failed: ${res.status}`);
			}
		}
		// A COMMENT verdict is represented by the general PR comment above.
	}

	async getPRFiles(owner: string, repo: string, prNumber: number): Promise<NormalizedPRFile[]> {
		const files: NormalizedPRFile[] = [];
		const repoUrl = `${BITBUCKET_API_BASE}/repositories/${owner}/${repo}/`;
		let url: string | null = `${repoUrl}pullrequests/${prNumber}/diffstat?pagelen=500`;
		const pages = new Set<string>();
		const paths = new Set<string>();
		let expectedSize: number | undefined;
		while (url) {
			const parsed = new URL(url);
			if (
				parsed.origin !== new URL(BITBUCKET_API_BASE).origin ||
				!parsed.pathname.startsWith(new URL(repoUrl).pathname) ||
				parsed.username ||
				parsed.password ||
				pages.has(parsed.href)
			) {
				throw new Error("Bitbucket file pagination left the repository or repeated a page");
			}
			pages.add(parsed.href);
			const res = await atlassianFetch("bitbucket", url);
			if (!res.ok) throw new Error(`Bitbucket file page failed: ${res.status}`);
			const data = (await res.json()) as {
				values?: Array<{
					new?: { path?: string } | null;
					old?: { path?: string } | null;
					status: string;
					lines_added?: number;
					lines_removed?: number;
				}>;
				next?: string | null;
				size?: number;
			};
			if (
				!data ||
				!Array.isArray(data.values) ||
				(data.next != null && (typeof data.next !== "string" || !data.next)) ||
				(data.next && data.values.length === 0)
			)
				throw new Error("Bitbucket file page is incomplete");
			if (data.size !== undefined) {
				if (
					!Number.isSafeInteger(data.size) ||
					data.size < 0 ||
					(expectedSize !== undefined && data.size !== expectedSize)
				)
					throw new Error("Bitbucket file count changed");
				expectedSize = data.size;
			}
			for (const file of data.values) {
				const path = file?.new?.path ?? file?.old?.path;
				if (
					typeof path !== "string" ||
					!path ||
					paths.has(path) ||
					typeof file.status !== "string"
				) {
					throw new Error("Bitbucket file manifest contains an invalid or duplicate file");
				}
				paths.add(path);
				files.push({
					path,
					status:
						file.status === "added"
							? "added"
							: file.status === "removed"
								? "removed"
								: file.status === "renamed"
									? "renamed"
									: "modified",
					previousPath: file.status === "renamed" ? file.old?.path : undefined,
					additions: file.lines_added ?? 0,
					deletions: file.lines_removed ?? 0,
				});
			}
			url = data.next ?? null;
		}
		if (expectedSize !== undefined && files.length !== expectedSize)
			throw new Error("Bitbucket file manifest is truncated");
		return files;
	}

	async getReviewThreads(): Promise<NormalizedReviewThread[]> {
		// Polling reconciliation does not yet consume the optional Bitbucket resolution metadata.
		return [];
	}

	// ── Bitbucket-specific extras ─────────────────────────────────────────────

	async getPRDetails(owner: string, repo: string, prNumber: number): Promise<GitHubPRDetails> {
		const prData = await getBitbucketPRDetails(owner, repo, prNumber);
		const [statuses, comments, files] = await Promise.all([
			getBitbucketPRStatuses(owner, repo, prNumber),
			getBitbucketPRComments(owner, repo, prNumber),
			this.getPRFiles(owner, repo, prNumber),
		]);

		// PR diffstat pages are mutable; do not certify files under a different revision.
		const current = await getBitbucketPRDetails(owner, repo, prNumber);
		if (
			!prData.headCommitOid ||
			!prData.baseCommitOid ||
			current.headCommitOid !== prData.headCommitOid ||
			current.baseCommitOid !== prData.baseCommitOid
		) {
			throw new Error("Bitbucket PR revision unavailable or changed while listing files");
		}

		const reviewerParticipants = prData.participants.filter((p) => p.role === "REVIEWER");
		const reviewers = reviewerParticipants.map(mapParticipantToReviewer);
		const ciState = aggregateCIState(statuses);
		const reviewDecision = deriveReviewDecision(reviewers);

		const { reviewThreads, conversationComments } = groupBitbucketComments(comments);

		const bbState = normalizeBBState(prData.state);

		return {
			title: prData.title,
			body: prData.description,
			state:
				bbState === "merged"
					? "MERGED"
					: bbState === "closed" || bbState === "declined"
						? "CLOSED"
						: "OPEN",
			isDraft: false,
			author: prData.author,
			authorAvatarUrl: prData.authorAvatarUrl,
			reviewDecision,
			ciState,
			checks: [],
			reviewers,
			reviewThreads,
			conversationComments,
			filesComplete: true,
			files: files.map((f) => ({
				path: f.path,
				additions: f.additions ?? 0,
				deletions: f.deletions ?? 0,
				changeType:
					f.status === "added"
						? ("ADDED" as const)
						: f.status === "removed"
							? ("DELETED" as const)
							: f.status === "renamed"
								? ("RENAMED" as const)
								: ("MODIFIED" as const),
			})),
			sourceBranch: prData.sourceBranch,
			targetBranch: prData.targetBranch,
			headCommitOid: prData.headCommitOid,
			baseCommitOid: prData.baseCommitOid,
		};
	}

	async getPRListEnrichment(
		prs: Array<{ workspace: string; repoSlug: string; prId: number }>
	): Promise<GitHubPREnriched[]> {
		const results: GitHubPREnriched[] = [];

		const settled = await Promise.allSettled(
			prs.map(async ({ workspace, repoSlug, prId }) => {
				const [prRes, statusRes] = await Promise.all([
					atlassianFetch(
						"bitbucket",
						`${BITBUCKET_API_BASE}/repositories/${workspace}/${repoSlug}/pullrequests/${prId}`
					),
					atlassianFetch(
						"bitbucket",
						`${BITBUCKET_API_BASE}/repositories/${workspace}/${repoSlug}/pullrequests/${prId}/statuses?pagelen=100`
					),
				]);

				const prData = prRes.ok
					? ((await prRes.json()) as {
							author?: { display_name?: string } | null;
							participants?: BitbucketParticipant[];
							updated_on?: string;
						})
					: null;

				const statusData = statusRes.ok
					? ((await statusRes.json()) as {
							values?: BitbucketStatus[];
						})
					: null;

				const reviewerParticipants = (prData?.participants ?? []).filter(
					(p) => p.role === "REVIEWER"
				);
				const reviewers = reviewerParticipants.map(mapParticipantToReviewer);
				const ciState = aggregateCIState(statusData?.values ?? []);
				const reviewDecision = deriveReviewDecision(reviewers);

				return {
					owner: workspace,
					repo: repoSlug,
					number: prId,
					author: prData?.author?.display_name ?? "Unknown",
					authorAvatarUrl: "",
					reviewers,
					ciState,
					reviewDecision,
					unresolvedThreadCount: 0,
					files: { additions: 0, deletions: 0, count: 0 },
					headCommitOid: "",
					mergeable: "UNKNOWN" as const,
					isDraft: false,
					updatedAt: prData?.updated_on ?? "",
				} satisfies GitHubPREnriched;
			})
		);

		for (const result of settled) {
			if (result.status === "fulfilled") {
				results.push(result.value);
			}
		}

		return results;
	}
}
