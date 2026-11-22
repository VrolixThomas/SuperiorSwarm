import "./preload-electron-mock";
import { beforeAll, beforeEach, expect, mock, test } from "bun:test";
import type { PRFeedbackEvent } from "../src/main/activity-queue/pr-feedback";
import { ActivityQueueService } from "../src/main/activity-queue/service";
import { getDb } from "../src/main/db";
import { activityQueueSources } from "../src/main/db/schema-activity-queue";
import type { PRActivityFacts } from "../src/main/providers/pr-activity";
import type { CachedPR } from "../src/shared/review-types";
import { setupTestDb } from "./helpers/db";
let account = "me";
let feedback: PRFeedbackEvent[] = [];
let fail = false;
mock.module("../src/main/activity-queue/pr-scope", () => ({
	currentPRScope: () => ({ accountId: account, host: "github.com" }),
}));
mock.module("../src/main/activity-queue/pr-feedback-fetch", () => ({
	fetchPRFeedback: async () => {
		if (fail) throw new Error("offline");
		return feedback;
	},
}));
const { observeScopedPRPoll } = await import("../src/main/activity-queue/pr-source");
const pr: CachedPR = {
	provider: "github",
	identifier: "owner/repo#7",
	number: 7,
	title: "PR title",
	state: "open",
	sourceBranch: "feature",
	targetBranch: "main",
	author: { login: "author", avatarUrl: "" },
	reviewers: [],
	ciStatus: null,
	commentCount: 0,
	changedFiles: 0,
	additions: 0,
	deletions: 0,
	updatedAt: "",
	repoOwner: "owner",
	repoName: "repo",
	projectId: "",
	role: "reviewer",
	headCommitSha: "head",
};
const facts: PRActivityFacts = {
	accountId: "me",
	authorAccountId: "other",
	viewerIsReviewer: true,
	state: "open",
	headSha: "head",
	isDraft: false,
	reviewRequested: true,
};
const queue = () => new ActivityQueueService();
async function poll(p = pr, f = facts) {
	await observeScopedPRPoll(
		[p],
		new Map([
			[
				`github:${p.repoOwner}/${p.repoName}#${p.number}`,
				p.role === "author" ? { ...f, authorAccountId: account } : f,
			],
		]),
		new Map()
	);
}
beforeAll(setupTestDb);
beforeEach(() => {
	account = "me";
	feedback = [];
	fail = false;
	getDb().delete(activityQueueSources).run();
});
test("author and reviewer queues stay distinct; own baseline and self-comments silent", async () => {
	await poll();
	expect(queue().list().items[0]?.kind).toBe("pr-review");
	getDb().delete(activityQueueSources).run();
	await poll({ ...pr, role: "author" });
	feedback = [{ id: "self", authorId: "me", author: "Me", body: "My update", at: 1 }];
	await poll({ ...pr, role: "author" });
	expect(queue().list().items).toEqual([]);
	feedback.push({
		id: "feedback",
		authorId: "other",
		author: "Reviewer",
		body: "Please fix",
		at: 2,
	});
	await poll({ ...pr, role: "author" });
	expect(queue().list().items[0]?.kind).toBe("pr-feedback");
});
test("feedback resolution, failed poll, Done and later new event", async () => {
	await poll({ ...pr, role: "author" });
	feedback = [{ id: "first", authorId: "other", author: "Reviewer", body: "Please fix", at: 2 }];
	await poll({ ...pr, role: "author" });
	const item = queue().list().items[0]!;
	fail = true;
	await poll({ ...pr, role: "author" });
	expect(queue().list().items[0]?.stale).toBe(true);
	fail = false;
	await poll({ ...pr, role: "author" });
	queue().acknowledge(item);
	await poll({ ...pr, role: "author" });
	expect(queue().list().items).toEqual([]);
	feedback.push({ ...feedback[0]!, id: "second" });
	await poll({ ...pr, role: "author" });
	expect(queue().list().items).toHaveLength(1);
	feedback = feedback.map((e) => ({ ...e, resolved: true }));
	await poll({ ...pr, role: "author" });
	expect(queue().list().items).toEqual([]);
});
test("outside-queue review on current head clears re-review", async () => {
	await poll(pr, { ...facts, reviewRequested: false, viewerReviewHead: "older" });
	await poll(pr, { ...facts, reviewRequested: false, headSha: "new", viewerReviewHead: "older" });
	expect(queue().list().items).toHaveLength(1);
	await poll(pr, {
		...facts,
		reviewRequested: false,
		headSha: "new",
		viewerReviewHead: "new",
		viewerReviewState: "APPROVED",
	});
	expect(queue().list().items).toEqual([]);
});
test("same PR number across repo/accounts has independent receipts", async () => {
	await poll();
	await poll({ ...pr, repoName: "other" });
	expect(queue().list().items).toHaveLength(2);
	const first = queue().list().items[0]!;
	queue().acknowledge(first);
	account = "second-account";
	await poll(pr, { ...facts, accountId: account });
	expect(queue().list().items).toHaveLength(2);
});
test("late old-account facts cannot populate the new account", async () => {
	account = "new";
	await poll();
	expect(queue().list().items).toEqual([]);
});
test("old-account cached author role never makes a new viewer an author", async () => {
	account = "new-viewer";
	const stale = { ...pr, role: "author" as const };
	await observeScopedPRPoll(
		[stale],
		new Map([
			[
				"github:owner/repo#7",
				{
					...facts,
					accountId: account,
					authorAccountId: "original-author",
					reviewRequested: false,
					viewerIsReviewer: false,
				},
			],
		]),
		new Map()
	);
	feedback = [
		{
			id: "incoming",
			authorId: "somebody",
			author: "Somebody",
			body: "Feedback for original author",
			at: 1,
		},
	];
	await observeScopedPRPoll(
		[stale],
		new Map([
			[
				"github:owner/repo#7",
				{
					...facts,
					accountId: account,
					authorAccountId: "original-author",
					reviewRequested: false,
					viewerIsReviewer: false,
				},
			],
		]),
		new Map()
	);
	expect(queue().list().items).toEqual([]);
});
test("Bitbucket outside review clears only a previously confirmed unchanged head", async () => {
	const bb = { ...pr, provider: "bitbucket" as const };
	const observe = (headSha: string, viewerReviewToken: string) =>
		observeScopedPRPoll(
			[bb],
			new Map([
				[
					"bitbucket:owner/repo#7",
					{
						...facts,
						headSha,
						reviewRequested: false,
						viewerIsReviewer: true,
						viewerReviewState: "approved",
						viewerReviewToken,
					},
				],
			]),
			new Map()
		);
	await observe("first", "old-review");
	await observe("second", "old-review");
	expect(queue().list().items).toHaveLength(1);
	await observe("second", "new-review");
	expect(queue().list().items).toEqual([]);
	await observe("second", "new-review");
	expect(queue().list().items).toEqual([]);
	await observe("third", "simultaneous-review");
	expect(queue().list().items).toHaveLength(1);
});
test("review stays pending when bounded review window loses viewer history", async () => {
	await poll(pr, { ...facts, reviewRequested: false, viewerReviewHead: "old" });
	await poll(pr, { ...facts, reviewRequested: false, headSha: "new", viewerReviewHead: "old" });
	expect(queue().list().items).toHaveLength(1);
	await poll(pr, {
		...facts,
		reviewRequested: false,
		headSha: "new",
		viewerReviewHead: undefined,
		viewerIsReviewer: undefined,
	});
	console.log("Pending after unknown bounded viewer history:", queue().list().items.length);
	expect(queue().list().items).toHaveLength(1);
});
