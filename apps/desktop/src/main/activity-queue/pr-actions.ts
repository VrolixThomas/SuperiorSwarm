import { eq } from "drizzle-orm";
import type { WorkspaceQueueRevisionInput } from "../../shared/activity-queue";
import { getDb } from "../db";
import { sessionState } from "../db/schema";
import { githubFetch } from "../github/auth";
import { getGitProvider } from "../providers/git-provider";
import { fetchQueuePRReviewEvidence } from "./pr-eligibility";
import { assertPRMutationAvailable } from "./pr-mutation-reservations";
import { isPRQueueItemCurrent } from "./pr-scope";
import { currentExternalQueueItem } from "./queue-view";
import { getActivityQueueService } from "./service";

type Receipt = {
	id: string;
	revision: number;
	headSha: string;
	approveAnyway: boolean;
	requestId: string;
	notBefore: number;
	expiresAt: number;
	status: "pending" | "cancelled" | "attempted" | "submitted" | "rejected";
	detail?: string;
};
const key = (id: string) => `queue-pr-review:${id}`;
function read(id: string): Receipt | null {
	const value = getDb()
		.select()
		.from(sessionState)
		.where(eq(sessionState.key, key(id)))
		.get();
	return value ? JSON.parse(value.value) : null;
}
function write(receipt: Receipt) {
	getDb()
		.insert(sessionState)
		.values({ key: key(receipt.requestId), value: JSON.stringify(receipt) })
		.onConflictDoUpdate({ target: sessionState.key, set: { value: JSON.stringify(receipt) } })
		.run();
}
function requireItem(input: WorkspaceQueueRevisionInput) {
	const item = currentExternalQueueItem(input);
	if (
		!item ||
		item.kind !== "pr-review" ||
		item.target.type !== "pr" ||
		!isPRQueueItemCurrent(item)
	)
		throw new Error("This review changed or its account is unavailable. Refresh the queue.");
	return { ...item, target: item.target };
}
export async function queuePRReviewCapability(input: WorkspaceQueueRevisionInput) {
	const item = requireItem(input);
	const target = item.target;
	if (target.provider === "bitbucket") {
		const state = await getGitProvider("bitbucket").getPRState(
			target.owner,
			target.repo,
			target.number
		);
		return {
			eligible: false,
			headSha: state.headSha,
			reasons: [
				"Bitbucket does not provide the complete GitHub re-review evidence. Inspect the review before choosing Approve anyway.",
			],
			evidence: [`Head: ${state.headSha}`],
		};
	}
	return fetchQueuePRReviewEvidence(
		target.owner,
		target.repo,
		target.number,
		target.accountId ?? ""
	);
}
/** Reserve an exact operation. Only the still-mounted renderer dispatches after five seconds. */
export async function prepareQueuePRReview(
	input: WorkspaceQueueRevisionInput & {
		headSha: string;
		approveAnyway: boolean;
		requestId: string;
	}
) {
	const existing = read(input.requestId);
	if (existing) {
		if (
			existing.id !== input.id ||
			existing.revision !== input.revision ||
			existing.headSha !== input.headSha ||
			existing.approveAnyway !== input.approveAnyway
		)
			throw new Error("Request ID belongs to another approval.");
		return existing;
	}

	assertPRMutationAvailable(input);
	requireItem(input);
	const capability = await queuePRReviewCapability(input);
	if (capability.headSha !== input.headSha || (!input.approveAnyway && !capability.eligible))
		throw new Error("The head or approval evidence changed. Review it again.");
	requireItem(input);
	return getDb().transaction(() => {
		const raced = read(input.requestId);
		if (raced) {
			if (
				raced.id !== input.id ||
				raced.revision !== input.revision ||
				raced.headSha !== input.headSha ||
				raced.approveAnyway !== input.approveAnyway
			)
				throw new Error("Request ID belongs to another approval.");
			return raced;
		}
		assertPRMutationAvailable(input);
		const now = Date.now();
		const receipt: Receipt = {
			...input,
			notBefore: now + 5000,
			expiresAt: now + 60000,
			status: "pending",
		};
		write(receipt);
		return receipt;
	});
}
export function cancelQueuePRReview(requestId: string) {
	const receipt = read(requestId);
	if (receipt?.status === "pending") {
		receipt.status = "cancelled";
		write(receipt);
	}
	return receipt;
}
export function queuePRReviewReceipt(requestId: string) {
	return read(requestId);
}
function finishSubmittedReceipt(receipt: Receipt) {
	try {
		// Repeating local cleanup is safe; never repeat the external submission.
		if (currentExternalQueueItem(receipt)) getActivityQueueService().acknowledge(receipt);
		receipt.detail = "Review submitted.";
	} catch {
		receipt.detail = "Review submitted. Queue cleanup is pending; retrying will not post again.";
	}
	write(receipt);
	return receipt;
}
export async function dispatchQueuePRReview(requestId: string) {
	const claim = getDb().transaction(() => {
		const current = read(requestId);
		if (!current) throw new Error("Approval reservation not found.");
		if (current.status !== "pending") return { receipt: current, won: false };
		if (Date.now() < current.notBefore) throw new Error("Approval undo period has not finished.");
		if (Date.now() > current.expiresAt) {
			current.status = "rejected";
			current.detail = "Approval expired. Inspect the latest review.";
			write(current);
			return { receipt: current, won: false };
		}
		// Durable at-most-once claim precedes any network call. Restart never blindly retries.
		current.status = "attempted";
		write(current);
		return { receipt: current, won: true };
	});
	// Only the caller winning the pending-to-attempted transition may dispatch.
	const receipt = claim.receipt;
	if (!claim.won) return receipt.status === "submitted" ? finishSubmittedReceipt(receipt) : receipt;
	let submissionAttempted = false;
	try {
		const item = requireItem(receipt);
		const target = item.target;
		const capability = await queuePRReviewCapability(receipt);
		if (capability.headSha !== receipt.headSha || (!receipt.approveAnyway && !capability.eligible))
			throw new Error("The current head or approval evidence changed. Nothing was submitted.");
		requireItem(receipt);
		// The final head read catches updates while the richer evidence was loading.
		const state = await getGitProvider(target.provider).getPRState(
			target.owner,
			target.repo,
			target.number
		);
		if (state.state !== "open" || state.headSha !== receipt.headSha)
			throw new Error("The PR changed before submission. Nothing was submitted.");
		requireItem(receipt);
		try {
			submissionAttempted = true;
			if (target.provider === "github") {
				const response = await githubFetch(
					`/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/pulls/${target.number}/reviews`,
					{
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ event: "APPROVE", commit_id: receipt.headSha, body: "" }),
					}
				);
				if (!response.ok) {
					if (response.status >= 500) throw new Error("uncertain");
					receipt.status = "rejected";
					receipt.detail =
						"The provider rejected the approval. Inspect the review before trying again.";
					write(receipt);
					return receipt;
				}
			} else
				await getGitProvider(target.provider).submitReview({
					owner: target.owner,
					repo: target.repo,
					prNumber: target.number,
					verdict: "APPROVE",
					body: "",
				});
		} catch {
			receipt.detail =
				"Submission outcome is unknown. Check the provider; this request will not be retried.";
			write(receipt);
			return receipt;
		}
		receipt.status = "submitted";
		receipt.detail = "Review submitted.";
		write(receipt);
		// A newer occurrence must remain pending.
		return finishSubmittedReceipt(receipt);
	} catch (error) {
		// Any failure after the irreversible call must keep the durable occurrence reserved.
		if (submissionAttempted) {
			if (receipt.status !== "submitted") receipt.status = "attempted";
			return receipt;
		}
		receipt.status = "rejected";
		receipt.detail =
			error instanceof Error ? error.message : "Approval check failed. Nothing was submitted.";
		write(receipt);
		return receipt;
	}
}
