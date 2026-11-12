import { eq } from "drizzle-orm";
import type { CachedPR } from "../../shared/review-types";
import { getDb } from "../db";
import { reviewDrafts } from "../db/schema";
import { type PRActivityFacts, prIdentity } from "../providers/pr-activity";
import { classifyPR, readPRSnapshot } from "./pr-classification";
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
	error?: string
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
						: undefined)
		);
	}
}
