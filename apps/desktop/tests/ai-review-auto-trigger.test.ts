import { describe, expect, test } from "bun:test";
import { shouldAutoTriggerReview } from "../src/main/ai-review/auto-trigger";
import type { CachedPR } from "../src/shared/review-types";

const basePr: CachedPR = {
	provider: "github",
	identifier: "acme/widgets#42",
	number: 42,
	title: "Add widgets",
	state: "open",
	sourceBranch: "feature/widgets",
	targetBranch: "main",
	author: { login: "alice", avatarUrl: "" },
	reviewers: [],
	ciStatus: null,
	commentCount: 0,
	changedFiles: 0,
	additions: 0,
	deletions: 0,
	updatedAt: new Date().toISOString(),
	repoOwner: "acme",
	repoName: "widgets",
	projectId: "project-1",
	role: "reviewer",
};

describe("auto-trigger decision", () => {
	test("does not trigger when auto review disabled", () => {
		const shouldTrigger = shouldAutoTriggerReview({
			pr: basePr,
			autoReviewEnabled: false,
			existingDrafts: new Set(),
			alreadyTriggered: new Set(),
		});
		expect(shouldTrigger).toBe(false);
	});

	test("does not trigger when PR is not open", () => {
		const shouldTrigger = shouldAutoTriggerReview({
			pr: { ...basePr, state: "closed" },
			autoReviewEnabled: true,
			existingDrafts: new Set(),
			alreadyTriggered: new Set(),
		});
		expect(shouldTrigger).toBe(false);
	});

	test("does not trigger for non-reviewer PR", () => {
		const shouldTrigger = shouldAutoTriggerReview({
			pr: { ...basePr, role: "author" },
			autoReviewEnabled: true,
			existingDrafts: new Set(),
			alreadyTriggered: new Set(),
		});
		expect(shouldTrigger).toBe(false);
	});

	test("does not trigger when no project is tracked", () => {
		const shouldTrigger = shouldAutoTriggerReview({
			pr: { ...basePr, projectId: "" },
			autoReviewEnabled: true,
			existingDrafts: new Set(),
			alreadyTriggered: new Set(),
		});
		expect(shouldTrigger).toBe(false);
	});

	test("does not trigger when a draft already exists", () => {
		const shouldTrigger = shouldAutoTriggerReview({
			pr: basePr,
			autoReviewEnabled: true,
			existingDrafts: new Set([basePr.identifier]),
			alreadyTriggered: new Set(),
		});
		expect(shouldTrigger).toBe(false);
	});

	test("does not trigger when already attempted this session", () => {
		const shouldTrigger = shouldAutoTriggerReview({
			pr: basePr,
			autoReviewEnabled: true,
			existingDrafts: new Set(),
			alreadyTriggered: new Set([basePr.identifier]),
		});
		expect(shouldTrigger).toBe(false);
	});

	test("triggers when all conditions are met", () => {
		const shouldTrigger = shouldAutoTriggerReview({
			pr: basePr,
			autoReviewEnabled: true,
			existingDrafts: new Set(),
			alreadyTriggered: new Set(),
		});
		expect(shouldTrigger).toBe(true);
	});
});
