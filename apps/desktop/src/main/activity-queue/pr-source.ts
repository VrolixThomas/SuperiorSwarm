import { and, eq } from "drizzle-orm";
import type { ActivityQueueItem, ExternalQueueItem } from "../../shared/activity-queue";
import type { CachedPR } from "../../shared/review-types";
import { getDb } from "../db";
import { projects, reviewDrafts, workspaces } from "../db/schema";
import { type PRActivityFacts, prIdentity } from "../providers/pr-activity";
import { classifyPR, readPRSnapshot } from "./pr-classification";
import { type PRFeedbackSnapshot, classifyPRFeedback } from "./pr-feedback";
import { fetchPRFeedback } from "./pr-feedback-fetch";
import { currentPRScope } from "./pr-scope";
import { type ActivityQueueService, getActivityQueueService } from "./service";

export function prSourceId(
	pr: Pick<CachedPR, "provider" | "repoOwner" | "repoName" | "number">
): string {
	return `pr:${prIdentity(pr.provider, pr.repoOwner, pr.repoName, pr.number)}`;
}

/** Independent from Open/markCommitSeen: only queue receipts acknowledge attention. */
export function observePRActivity(
	pr: CachedPR,
	facts: PRActivityFacts,
	readyDraftIds: string[],
	observedAt = Date.now(),
	queue: ActivityQueueService = getActivityQueueService(),
	error?: string,
	projectName?: string
): void {
	const sourceId = prSourceId(pr);
	const source = queue.read(sourceId);
	const previous = readPRSnapshot(source?.snapshot);
	const result = classifyPR(
		previous,
		facts,
		readyDraftIds,
		observedAt,
		Boolean(source && source.acknowledgedRevision === source.revision)
	);
	queue.observe({
		sourceId,
		sourceType: "pr",
		snapshot: result.snapshot,
		fingerprint: result.fingerprint,
		observedAt,
		candidate: result.kind
			? {
					kind: result.kind,
					title: pr.title,
					summary: result.reasons.join(" · "),
					projectId: pr.projectId || undefined,
					projectName,
					occurredAt: result.snapshot.occurredAt,
					reasons: result.reasons.map((label) => ({
						code: `pr-${label.toLowerCase().replaceAll(" ", "-")}`,
						label,
					})),
					target: {
						type: "pr",
						provider: pr.provider,
						owner: pr.repoOwner,
						repo: pr.repoName,
						number: pr.number,
						title: pr.title,
						sourceBranch: pr.sourceBranch,
						targetBranch: pr.targetBranch,
						projectId: pr.projectId || undefined,
					},
				}
			: null,
	});
	if (error) queue.markUnavailable(sourceId, error);
}

/** Reconcile on the existing PR poll, including failed/disconnected provider cycles. */
export function observePRPoll(
	prs: CachedPR[],
	observations: Map<string, PRActivityFacts>,
	errors: Map<string, string>
): void {
	const drafts = getDb().select().from(reviewDrafts).where(eq(reviewDrafts.status, "ready")).all();
	const now = Date.now();
	const queue = getActivityQueueService();
	const names = new Map(
		getDb()
			.select({ id: projects.id, name: projects.name })
			.from(projects)
			.all()
			.map((project) => [project.id, project.name])
	);
	for (const pr of prs) {
		const id = prIdentity(pr.provider, pr.repoOwner, pr.repoName, pr.number);
		const facts = observations.get(id);
		if (!facts && pr.state !== "open") continue;
		const partial =
			facts &&
			(facts.state === undefined ||
				(facts.state === "open" &&
					(!facts.headSha || facts.isDraft === undefined || facts.reviewRequested === undefined)));
		observePRActivity(
			pr,
			facts ?? {},
			drafts
				.filter((d) => d.prProvider === pr.provider && d.prIdentifier === pr.identifier)
				.map((d) => d.id),
			now,
			queue,
			errors.get(id) ??
				(!facts
					? "PR status not confirmed in this poll"
					: partial
						? "Some PR review metadata is unavailable"
						: undefined),
			names.get(pr.projectId)
		);
	}
}

/** Scoped production source: legacy unscoped baselines are never admitted by QueueView. */
export async function observeScopedPRPoll(
	prs: CachedPR[],
	observations: Map<string, PRActivityFacts>,
	errors: Map<string, string>
) {
	const queue = getActivityQueueService();
	const names = new Map(
		getDb()
			.select()
			.from(projects)
			.all()
			.map((p) => [p.id, p.name])
	);
	for (const pr of prs) {
		const scope = currentPRScope(pr.provider);
		if (!scope) continue;
		const sourceId = `pr:${JSON.stringify([pr.provider, scope.host, scope.accountId, pr.repoOwner, pr.repoName, pr.number])}`;
		const key = prIdentity(pr.provider, pr.repoOwner, pr.repoName, pr.number);
		const facts = observations.get(key);
		const previous = queue.read(sourceId);
		const now = Date.now();
		if (!facts || facts.accountId !== scope.accountId || errors.has(key)) {
			if (previous)
				queue.markUnavailable(
					sourceId,
					"PR activity could not be refreshed. Previous attention is retained."
				);
			continue;
		}
		if (facts.state && facts.state !== "open") {
			queue.resolve(sourceId, now);
			continue;
		}
		if (
			facts.state !== "open" ||
			!facts.headSha ||
			facts.isDraft === undefined ||
			!facts.authorAccountId ||
			facts.reviewRequested === undefined
		) {
			if (previous) queue.markUnavailable(sourceId, "PR review metadata is incomplete.");
			continue;
		}
		const target = {
			type: "pr" as const,
			provider: pr.provider,
			...scope,
			owner: pr.repoOwner,
			repo: pr.repoName,
			number: pr.number,
			title: pr.title,
			sourceBranch: pr.sourceBranch,
			targetBranch: pr.targetBranch,
			projectId: pr.projectId || undefined,
		};
		try {
			if (facts.authorAccountId === scope.accountId) {
				const events = await fetchPRFeedback(pr.provider, pr.repoOwner, pr.repoName, pr.number);
				if (currentPRScope(pr.provider)?.accountId !== scope.accountId) continue;
				const old = readPRFeedbackSnapshot(previous?.snapshot);
				const snapshot = classifyPRFeedback(
					old,
					events,
					scope.accountId,
					!!previous && previous.acknowledgedRevision === previous.revision
				);
				// Keep the occurrence stable after Done until genuinely new feedback arrives.
				const newIds = snapshot.pending.map((e) => e.id).sort();
				const kind = "pr-feedback" as const;
				queue.observe({
					sourceId,
					sourceType: "pr-feedback",
					snapshot: { ...snapshot, headSha: facts.headSha },
					fingerprint: JSON.stringify(newIds),
					observedAt: now,
					candidate: snapshot.pending.length
						? {
								kind,
								title: pr.title,
								summary: `${snapshot.pending.length} new feedback item${snapshot.pending.length === 1 ? "" : "s"} on your PR`,
								projectId: pr.projectId || undefined,
								projectName: names.get(pr.projectId),
								occurredAt: Math.max(...snapshot.pending.map((e) => e.at), now),
								reasons: snapshot.pending.map((e) => ({
									code: e.id,
									label: `${e.author}: ${e.body.slice(0, 1200)}`,
								})),
								target,
							}
						: null,
				});
			} else {
				const old = readPRSnapshot(previous?.snapshot);
				if (facts.reviewRequested !== true && facts.viewerIsReviewer === undefined && previous) {
					queue.markUnavailable(
						sourceId,
						"Your review history is incomplete. Previous attention is retained."
					);
					continue;
				}
				const result = classifyPR(
					old,
					facts,
					[],
					now,
					!!previous && previous.acknowledgedRevision === previous.revision
				);

				const headChanged = old?.headSha !== facts.headSha;
				const confirmedBitbucketReview =
					pr.provider === "bitbucket" &&
					!headChanged &&
					!!old?.viewerReviewToken &&
					!!facts.viewerReviewToken &&
					facts.viewerReviewToken !== old.viewerReviewToken &&
					["approved", "changes_requested"].includes(facts.viewerReviewState ?? "");
				if (confirmedBitbucketReview) result.snapshot.handledHeadSha = facts.headSha;
				const reviewedCurrent =
					facts.viewerReviewHead === facts.headSha ||
					result.snapshot.handledHeadSha === facts.headSha;
				const needsReview =
					facts.reviewRequested === true ||
					(facts.viewerIsReviewer === true &&
						!reviewedCurrent &&
						!!old &&
						result.snapshot.updates.includes("head"));

				queue.observe({
					sourceId,
					sourceType: "pr",
					snapshot: result.snapshot,
					fingerprint: result.fingerprint,
					observedAt: now,
					candidate: needsReview
						? {
								kind: "pr-review",
								title: pr.title,
								summary: facts.reviewRequested
									? "Your review was requested"
									: "New commits since your previous review",
								projectId: pr.projectId || undefined,
								projectName: names.get(pr.projectId),
								occurredAt: result.snapshot.occurredAt,
								reasons: result.reasons.map((label) => ({ code: "review-update", label })),
								target,
							}
						: null,
				});
			}
		} catch {
			if (previous)
				queue.markUnavailable(
					sourceId,
					"PR feedback could not be refreshed completely. Previous attention is retained."
				);
		}
	}
}
function readPRFeedbackSnapshot(value: unknown): PRFeedbackSnapshot | undefined {
	if (!value || typeof value !== "object") return;
	const v = value as Partial<PRFeedbackSnapshot>;
	if (
		v.version !== 1 ||
		!Array.isArray(v.seen) ||
		!v.seen.every((x) => typeof x === "string") ||
		!Array.isArray(v.pending) ||
		!v.pending.every(
			(e) =>
				e &&
				typeof e.id === "string" &&
				typeof e.authorId === "string" &&
				typeof e.author === "string" &&
				typeof e.body === "string" &&
				typeof e.at === "number"
		)
	)
		return;
	return v as PRFeedbackSnapshot;
}
export function describePRQueueItem(item: ActivityQueueItem): ExternalQueueItem | null {
	if (item.target.type !== "pr" || !["pr-review", "pr-feedback"].includes(item.kind)) return null;
	const target = item.target;
	const identifier = `${target.owner}/${target.repo}#${target.number}`;
	const links = getDb()
		.select()
		.from(workspaces)
		.where(and(eq(workspaces.prProvider, target.provider), eq(workspaces.prIdentifier, identifier)))
		.all()
		.filter((w) => !target.projectId || w.projectId === target.projectId);
	const linked = links.length === 1 ? links[0] : undefined;
	const own = item.kind === "pr-feedback";
	return {
		...item,
		category: "prs",
		situation: own ? "pr-feedback" : "pr-review",
		subject: `${identifier} · ${item.title}`,
		why: item.summary,
		clearsWhen: own
			? "Clears when the feedback is resolved at the provider, or you dismiss this occurrence with Done. Opening does not dismiss it."
			: "Clears after a successful review or when the request closes. Done dismisses only this occurrence.",
		sourceLabel: `${target.provider === "github" ? "GitHub" : "Bitbucket"} · ${own ? "Feedback on your PR" : "Review requested"}`,
		nextAction: own
			? "Read the feedback and respond in the review. A linked workspace can run the local feedback solver."
			: "Open the review and inspect the changes. Approval always requires your explicit decision.",
		openLabel: "Open PR review",
		detailLabel: own ? "Feedback requiring attention" : "Review context",
		evidence: item.reasons.map((r) => r.label),
		missingContext:
			own && !linked
				? links.length > 1
					? "Several workspaces link this PR. Choose the intended workspace before solving."
					: "No workspace is linked. Open or link a workspace to this PR before solving feedback."
				: undefined,
		context: {
			projectId: item.projectId,
			projectName: item.projectName ?? `${target.owner}/${target.repo}`,
			projectTint: 1,
			workspaceId: linked?.id,
			workspaceName: linked?.name,
		},
	};
}
