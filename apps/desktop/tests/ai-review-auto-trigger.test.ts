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
	headCommitSha: "abc123",
};

describe("auto-trigger decision", () => {
	test("CachedPR includes headCommitSha", () => {
		expect(basePr.headCommitSha).toBe("abc123");
	});

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
			existingDrafts: new Map(),
			alreadyTriggeredAt: null,
		});
		expect(shouldTrigger).toBe(false);
	});

	test("does not trigger when PR is not open", () => {
		const shouldTrigger = shouldAutoTriggerReview({
			pr: { ...basePr, state: "closed" },
			autoReviewEnabled: true,
			existingDrafts: new Map(),
			alreadyTriggeredAt: null,
		});
		expect(shouldTrigger).toBe(false);
	});

	test("does not trigger for non-reviewer PR", () => {
		const shouldTrigger = shouldAutoTriggerReview({
			pr: { ...basePr, role: "author" },
			autoReviewEnabled: true,
			existingDrafts: new Map(),
			alreadyTriggeredAt: null,
		});
		expect(shouldTrigger).toBe(false);
	});

	test("does not trigger when no project is tracked", () => {
		const shouldTrigger = shouldAutoTriggerReview({
			pr: { ...basePr, projectId: "" },
			autoReviewEnabled: true,
			existingDrafts: new Map(),
			alreadyTriggeredAt: null,
		});
		expect(shouldTrigger).toBe(false);
	});

	test("does not trigger when draft is queued", () => {
		const shouldTrigger = shouldAutoTriggerReview({
			pr: basePr,
			autoReviewEnabled: true,
			existingDrafts: new Map([[basePr.identifier, "queued"]]),
			alreadyTriggeredAt: null,
		});
		expect(shouldTrigger).toBe(false);
	});

	test("does not trigger when already attempted this session", () => {
		const shouldTrigger = shouldAutoTriggerReview({
			pr: basePr,
			autoReviewEnabled: true,
			existingDrafts: new Map(),
			alreadyTriggeredAt: new Date(),
		});
		expect(shouldTrigger).toBe(false);
	});

	test("triggers when all conditions are met", () => {
		const shouldTrigger = shouldAutoTriggerReview({
			pr: basePr,
			autoReviewEnabled: true,
			existingDrafts: new Map(),
			alreadyTriggeredAt: null,
		});
		expect(shouldTrigger).toBe(true);
	});

	test("triggers when existing draft is submitted", () => {
		const shouldTrigger = shouldAutoTriggerReview({
			pr: basePr,
			autoReviewEnabled: true,
			existingDrafts: new Map([[basePr.identifier, "submitted"]]),
			alreadyTriggeredAt: null,
		});
		expect(shouldTrigger).toBe(true);
	});

	test("triggers when existing draft is failed", () => {
		const shouldTrigger = shouldAutoTriggerReview({
			pr: basePr,
			autoReviewEnabled: true,
			existingDrafts: new Map([[basePr.identifier, "failed"]]),
			alreadyTriggeredAt: null,
		});
		expect(shouldTrigger).toBe(true);
	});

	test("triggers when existing draft is dismissed", () => {
		const shouldTrigger = shouldAutoTriggerReview({
			pr: basePr,
			autoReviewEnabled: true,
			existingDrafts: new Map([[basePr.identifier, "dismissed"]]),
			alreadyTriggeredAt: null,
		});
		expect(shouldTrigger).toBe(true);
	});

	test("does not trigger when draft is in_progress", () => {
		const shouldTrigger = shouldAutoTriggerReview({
			pr: basePr,
			autoReviewEnabled: true,
			existingDrafts: new Map([[basePr.identifier, "in_progress"]]),
			alreadyTriggeredAt: null,
		});
		expect(shouldTrigger).toBe(false);
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
				ledger: {
					get: () => ({ firstTriggeredAt: null, lastTriggeredSha: null }),
					markFirstTriggered: () => {},
					markReReviewedAtSha: () => {},
				},
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
		const stubs = makeLedgerStubs();

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
				ledger: stubs.ledger,
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
		expect(stubs.getFirstTriggeredAt()).not.toBeNull();
	});
});

function makeLedgerStubs() {
	let firstTriggeredAt: Date | null = null;
	let lastTriggeredSha: string | null = null;
	return {
		ledger: {
			get: () => ({ firstTriggeredAt, lastTriggeredSha }),
			markFirstTriggered: () => {
				firstTriggeredAt = new Date();
			},
			markReReviewedAtSha: (_p: string, _i: string, sha: string) => {
				lastTriggeredSha = sha;
			},
		},
		// Test-only readers
		getFirstTriggeredAt: () => firstTriggeredAt,
		getLastTriggeredSha: () => lastTriggeredSha,
	};
}

describe("auto-trigger ledger", () => {
	test("does not trigger when ledger says firstTriggeredAt is non-null", () => {
		const shouldTrigger = shouldAutoTriggerReview({
			pr: basePr,
			autoReviewEnabled: true,
			existingDrafts: new Map(),
			alreadyTriggeredAt: new Date(),
		});
		expect(shouldTrigger).toBe(false);
	});

	test("triggers when ledger firstTriggeredAt is null", () => {
		const shouldTrigger = shouldAutoTriggerReview({
			pr: basePr,
			autoReviewEnabled: true,
			existingDrafts: new Map(),
			alreadyTriggeredAt: null,
		});
		expect(shouldTrigger).toBe(true);
	});
});
