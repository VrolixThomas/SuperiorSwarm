import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { QueuePROrigin, QueuePRPublication } from "../../shared/queue-pr-publication";
import { type PublishResult, publishReview } from "../ai-review/review-publisher";
import { publishGroup, publishSolve } from "../ai-review/solve-publisher";
import { getDb } from "../db";
import { draftComments, reviewDrafts, sessionState } from "../db/schema";
import { githubFetch } from "../github/auth";
import { getGitProvider } from "../providers/git-provider";
import type { GitProvider } from "../providers/types";
import { assertPRMutationAvailable } from "./pr-mutation-reservations";
import { isPRQueueItemCurrent } from "./pr-scope";
import { currentExternalQueueItem } from "./queue-view";
import { getActivityQueueService } from "./service";
import { assertSolveMutationCurrent, solvePublicationSnapshot } from "./solve-publication";
interface Receipt {
	origin: QueuePROrigin;
	requestId: string;
	headSha: string;
	operation: QueuePRPublication;
	draftDigest: string | null;
	solveHead?: string;
	notBefore: number;
	expiresAt: number;
	status: "pending" | "cancelled" | "attempted" | "submitted" | "rejected";
	detail?: string;
	outcome?: PublishResult;
}
const key = (id: string) => `queue-pr-publication:${id}`;
const read = (id: string): Receipt | null => {
	const row = getDb()
		.select()
		.from(sessionState)
		.where(eq(sessionState.key, key(id)))
		.get();
	return row ? JSON.parse(row.value) : null;
};
function write(receipt: Receipt) {
	getDb()
		.insert(sessionState)
		.values({ key: key(receipt.requestId), value: JSON.stringify(receipt) })
		.onConflictDoUpdate({ target: sessionState.key, set: { value: JSON.stringify(receipt) } })
		.run();
}
function requireItem(origin: QueuePROrigin) {
	const item = currentExternalQueueItem(origin);
	if (!item || item.target.type !== "pr" || !isPRQueueItemCurrent(item))
		throw new Error("The queue occurrence or account changed. Reopen it from Queue.");
	return { ...item, target: item.target };
}
function draftDigest(origin: QueuePROrigin, operation: QueuePRPublication) {
	if (operation.kind === "solve") return solvePublicationSnapshot(origin, operation).signature;
	if (operation.kind !== "draft") return null;
	const { target } = requireItem(origin);
	const draft = getDb()
		.select()
		.from(reviewDrafts)
		.where(eq(reviewDrafts.id, operation.draftId))
		.get();
	if (
		!draft ||
		draft.prProvider !== target.provider ||
		draft.prIdentifier !== `${target.owner}/${target.repo}#${target.number}`
	)
		throw new Error("The draft does not belong to this queue PR.");
	const comments = getDb()
		.select()
		.from(draftComments)
		.where(eq(draftComments.reviewDraftId, draft.id))
		.all()
		.sort((a, b) => a.id.localeCompare(b.id));
	const originals = comments
		.filter((comment) => comment.previousCommentId)
		.map((comment) => {
			const original = getDb()
				.select()
				.from(draftComments)
				.where(eq(draftComments.id, comment.previousCommentId!))
				.get();
			const owner = original
				? getDb()
						.select()
						.from(reviewDrafts)
						.where(eq(reviewDrafts.id, original.reviewDraftId))
						.get()
				: null;
			if (
				!original ||
				!owner ||
				owner.prProvider !== target.provider ||
				owner.prIdentifier !== draft.prIdentifier
			)
				throw new Error("A resolution comment belongs to another PR or is unavailable.");
			return original;
		});
	return createHash("sha256")
		.update(JSON.stringify([draft, comments, originals]))
		.digest("hex");
}
async function validate(receipt: Receipt, expectedHead = receipt.headSha) {
	const { target } = requireItem(receipt.origin);
	const state = await getGitProvider(target.provider).getPRState(
		target.owner,
		target.repo,
		target.number
	);
	if (state.state !== "open" || state.headSha !== expectedHead)
		throw new Error("The PR head changed. Inspect it again before publishing.");
	requireItem(receipt.origin);
	return target;
}
export async function prepareQueuePRPublication(input: {
	origin: QueuePROrigin;
	requestId: string;
	headSha: string;
	operation: QueuePRPublication;
}) {
	const existing = read(input.requestId);
	if (existing) {
		if (
			JSON.stringify([existing.origin, existing.headSha, existing.operation]) !==
			JSON.stringify([input.origin, input.headSha, input.operation])
		)
			throw new Error("Request ID belongs to another publication.");
		return existing;
	}
	const receipt: Receipt = {
		...input,
		draftDigest: draftDigest(input.origin, input.operation),
		solveHead:
			input.operation.kind === "solve"
				? solvePublicationSnapshot(input.origin, input.operation).head
				: undefined,
		notBefore: 0,
		expiresAt: 0,
		status: "pending",
	};
	assertPRMutationAvailable(receipt.origin, receipt.operation);
	await validate(receipt);
	if (draftDigest(input.origin, input.operation) !== receipt.draftDigest)
		throw new Error("The draft changed while preparing publication.");
	return getDb().transaction(() => {
		assertPRMutationAvailable(receipt.origin, receipt.operation);
		if (read(input.requestId)) throw new Error("This request is already reserved.");
		receipt.notBefore = Date.now() + 5000;
		receipt.expiresAt = Date.now() + 60000;
		write(receipt);
		return receipt;
	});
}
export function cancelQueuePRPublication(requestId: string) {
	const receipt = read(requestId);
	if (receipt?.status === "pending") {
		receipt.status = "cancelled";
		write(receipt);
	}
	return receipt;
}
export async function dispatchQueuePRPublication(requestId: string) {
	const receipt = read(requestId);
	if (!receipt) throw new Error("Publication reservation missing.");
	if (receipt.status !== "pending") return receipt;
	if (Date.now() < receipt.notBefore) throw new Error("Publication undo period has not finished.");
	let attempted = false;
	let externalStarted = false;
	try {
		if (Date.now() > receipt.expiresAt) throw new Error("Publication expired.");
		const target = await validate(receipt);
		if (draftDigest(receipt.origin, receipt.operation) !== receipt.draftDigest)
			throw new Error("The draft changed. Review it again.");
		const provider = getGitProvider(target.provider);
		const operation = receipt.operation;
		const solve =
			operation.kind === "solve" ? solvePublicationSnapshot(receipt.origin, operation) : null;
		if (
			solve &&
			(solve.context.accountId !== target.accountId ||
				solve.context.host !== target.host ||
				solve.context.prCtx.provider !== target.provider)
		)
			throw new Error("Solver account scope changed.");
		if (
			target.provider === "github" &&
			(operation.kind === "reply" || operation.kind === "resolve")
		) {
			const threads = await provider.getReviewThreads(target.owner, target.repo, target.number);
			if (!threads.some((thread) => thread.nodeId === operation.commentId))
				throw new Error("The thread is not in this PR.");
			await validate(receipt);
		}
		// Undo remains possible during async validation; only the final claim can dispatch.
		const won = getDb().transaction(() => {
			const current = read(requestId);
			if (current?.status !== "pending") return false;
			if (Date.now() > current.expiresAt) {
				current.status = "rejected";
				current.detail = "Publication expired.";
				write(current);
				return false;
			}
			requireItem(receipt.origin);
			receipt.status = "attempted";
			write(receipt);
			return true;
		});
		if (!won) return read(requestId)!;
		attempted = true;
		const params = { owner: target.owner, repo: target.repo, prNumber: target.number };
		let expectedHead = receipt.headSha;
		let expectedDraftDigest = receipt.draftDigest;
		const assertDraftCurrent = () => {
			if (operation.kind !== "draft") return;
			if (draftDigest(receipt.origin, operation) !== expectedDraftDigest)
				throw new Error("Draft content or approval changed before publication.");
		};
		const guard = async () => {
			await validate(receipt, expectedHead);
		};
		const guarded = new Proxy(provider, {
			get(object, property) {
				if (property === "submitReview")
					return async (input: Parameters<GitProvider["submitReview"]>[0]) => {
						await guard();
						assertDraftCurrent();
						externalStarted = true;
						if (target.provider === "github") {
							const response = await githubFetch(
								`/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/pulls/${target.number}/reviews`,
								{
									method: "POST",
									headers: { "Content-Type": "application/json" },
									body: JSON.stringify({
										event: input.verdict,
										body: input.body,
										commit_id: receipt.headSha,
									}),
								}
							);
							if (!response.ok) throw new Error("Provider submission did not return success.");
						} else await object.submitReview(input);
					};
				const value = Reflect.get(object, property);
				if (typeof value !== "function") return value;
				if (
					["createInlineComment", "replyToComment", "resolveComment", "unresolveComment"].includes(
						String(property)
					)
				)
					return async (...args: unknown[]) => {
						if (target.provider === "github" && property !== "createInlineComment") {
							const input = args[0] as { commentId?: string };
							const threads = await object.getReviewThreads(
								target.owner,
								target.repo,
								target.number
							);
							if (!threads.some((thread) => thread.nodeId === input.commentId))
								throw new Error("The thread is not in this PR.");
						}
						await guard();
						assertDraftCurrent();
						if (solve)
							assertSolveMutationCurrent(
								solve,
								String(property),
								args[0] as {
									commentId?: string;
									body?: string;
									queueReplyId?: string;
									queueCommentId?: string;
								}
							);
						externalStarted = true;
						return Reflect.apply(value, object, args);
					};
				return value.bind(object);
			},
		});
		let outcome: PublishResult = {
			success: true,
			postedCount: 0,
			failedCount: 0,
			skippedCount: 0,
			errors: [],
			verdictSubmitted: false,
		};
		if (operation.kind === "solve") {
			const pushGuard = {
				provider: guarded,
				beforePush: async () => {
					await guard();
					if (solvePublicationSnapshot(receipt.origin, operation).signature !== receipt.draftDigest)
						throw new Error("Solver content changed before push.");
					externalStarted = true;
				},
				afterPush: () => {
					expectedHead = receipt.solveHead ?? receipt.headSha;
				},
			};
			const result = operation.groupId
				? await publishGroup(operation.groupId, pushGuard)
				: await publishSolve(operation.sessionId, pushGuard);
			outcome = {
				success: result.pushed && result.errors.length === 0,
				postedCount: result.repliesPosted,
				failedCount: result.errors.length,
				skippedCount: 0,
				errors: result.errors,
				verdictSubmitted: false,
			};
		} else if (operation.kind === "draft")
			outcome = await publishReview(operation.draftId, operation.verdict, {
				provider: guarded,
				body: operation.body,
				beforePersist: assertDraftCurrent,
				afterPersist: () => {
					expectedDraftDigest = draftDigest(receipt.origin, operation);
				},
			});
		else if (operation.kind === "review") {
			await guarded.submitReview({ ...params, verdict: operation.verdict, body: operation.body });
			outcome.verdictSubmitted = true;
		} else if (operation.kind === "reply") {
			await guarded.replyToComment({
				...params,
				commentId: operation.commentId,
				body: operation.body,
			});
			outcome.postedCount = 1;
		} else await guarded.resolveComment({ ...params, commentId: operation.commentId });
		receipt.outcome = outcome;
		if (!outcome.success)
			throw new Error(
				"Publication was partial or uncertain. Inspect the provider before retrying."
			);
		receipt.status = "submitted";
		receipt.detail = "Published.";
		write(receipt);
		if (outcome.verdictSubmitted) {
			try {
				if (currentExternalQueueItem(receipt.origin))
					getActivityQueueService().acknowledge(receipt.origin);
			} catch {
				receipt.detail = "Published. Queue cleanup is pending.";
			}
		}
		return receipt;
	} catch (error) {
		// Async preflight can lose to another dispatch or cancellation. Only transition
		// the status this caller still owns; never write its stale pending snapshot.
		return getDb().transaction(() => {
			const current = read(requestId);
			if (!current) return receipt;
			if (current.status !== (attempted ? "attempted" : "pending")) return current;
			if (!attempted || !externalStarted) receipt.status = "rejected";
			receipt.detail = error instanceof Error ? error.message : "Publication failed.";
			try {
				write(receipt);
			} catch {
				/* The original durable attempted claim still prevents retry. */
			}
			return receipt;
		});
	}
}
