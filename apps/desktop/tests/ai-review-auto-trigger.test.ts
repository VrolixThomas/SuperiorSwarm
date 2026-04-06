import { describe, expect, test } from "bun:test";
import {
	maybeAutoTriggerReview,
	shouldAutoTriggerReview,
} from "../src/main/ai-review/auto-trigger";
import { ensureReviewWorkspace } from "../src/main/ai-review/review-workspace";
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
	test("exposes review workspace helper", () => {
		expect(ensureReviewWorkspace).toBeTypeOf("function");
	});

	test("supports reviewer role", () => {
		const reviewerRole: CachedPR["role"] = "reviewer";
		expect(reviewerRole).toBe("reviewer");
	});

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

	test("maybeAutoTriggerReview skips when disabled", async () => {
		const calls: string[] = [];
		const result = await maybeAutoTriggerReview({
			pr: basePr,
			deps: {
				getSettings: () => ({ autoReviewEnabled: 0 }),
				getReviewDrafts: () => [],
				getProjectIdByRepo: () => basePr.projectId,
				ensureReviewWorkspace: async () => {
					calls.push("ensure");
					return { workspaceId: "ws-1", worktreePath: "/tmp/ws" };
				},
				queueReview: async () => {
					calls.push("queue");
					return {
						draftId: "draft-1",
						reviewWorkspaceId: "ws-1",
						worktreePath: "/tmp/ws",
						launchScript: "/tmp/ws/start.sh",
					};
				},
				alreadyTriggered: new Set(),
			},
		});

		expect(result).toBe(null);
		expect(calls).toEqual([]);
	});

	test("maybeAutoTriggerReview queues reviewer PRs", async () => {
		const ensureCalls: Array<{
			projectId: string;
			prProvider: string;
			prIdentifier: string;
			prTitle: string;
			sourceBranch: string;
			targetBranch: string;
		}> = [];
		const queueCalls: Array<{
			prProvider: string;
			prIdentifier: string;
			prTitle: string;
			prAuthor: string;
			sourceBranch: string;
			targetBranch: string;
			workspaceId: string;
			worktreePath: string;
		}> = [];
		const alreadyTriggered = new Set<string>();

		const result = await maybeAutoTriggerReview({
			pr: basePr,
			deps: {
				getSettings: () => ({ autoReviewEnabled: 1 }),
				getReviewDrafts: () => [],
				getProjectIdByRepo: () => basePr.projectId,
				ensureReviewWorkspace: async (opts: {
					projectId: string;
					prProvider: string;
					prIdentifier: string;
					prTitle: string;
					sourceBranch: string;
					targetBranch: string;
				}) => {
					ensureCalls.push(opts);
					return { workspaceId: "ws-1", worktreePath: "/tmp/ws" };
				},
				queueReview: async (opts: {
					prProvider: string;
					prIdentifier: string;
					prTitle: string;
					prAuthor: string;
					sourceBranch: string;
					targetBranch: string;
					workspaceId: string;
					worktreePath: string;
				}) => {
					queueCalls.push(opts);
					return {
						draftId: "draft-1",
						reviewWorkspaceId: "ws-1",
						worktreePath: "/tmp/ws",
						launchScript: "/tmp/ws/start.sh",
					};
				},
				alreadyTriggered,
			},
		});

		expect(result).toEqual({
			draftId: "draft-1",
			reviewWorkspaceId: "ws-1",
			worktreePath: "/tmp/ws",
			launchScript: "/tmp/ws/start.sh",
		});
		expect(ensureCalls).toEqual([
			{
				projectId: basePr.projectId,
				prProvider: basePr.provider,
				prIdentifier: basePr.identifier,
				prTitle: basePr.title,
				sourceBranch: basePr.sourceBranch,
				targetBranch: basePr.targetBranch,
			},
		]);
		expect(queueCalls).toEqual([
			{
				prProvider: basePr.provider,
				prIdentifier: basePr.identifier,
				prTitle: basePr.title,
				prAuthor: basePr.author.login,
				sourceBranch: basePr.sourceBranch,
				targetBranch: basePr.targetBranch,
				workspaceId: "ws-1",
				worktreePath: "/tmp/ws",
			},
		]);
		expect(alreadyTriggered.has(basePr.identifier)).toBe(true);
	});
});
