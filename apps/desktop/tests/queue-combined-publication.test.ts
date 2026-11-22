import "./preload-electron-mock";
import { afterEach, beforeAll, beforeEach, expect, mock, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import type { PRFeedbackEvent } from "../src/main/activity-queue/pr-feedback";
import { getDb } from "../src/main/db";
import {
	commentGroups,
	commentReplies,
	commentSolveSessions,
	githubAuth,
	prComments,
	projects,
	sessionState,
	terminalSessions,
	workspaces,
	worktrees,
} from "../src/main/db/schema";
import { activityQueueSnoozes, activityQueueSources } from "../src/main/db/schema-activity-queue";
import type { ActivityQueueItem, ExternalQueueItem } from "../src/shared/activity-queue";
import type { CachedPR } from "../src/shared/review-types";
import { setupTestDb } from "./helpers/db";
let posts: unknown[] = [];
let pushes = 0;
let gitRoot: string | undefined;
mock.module("../src/main/ai-review/solve-publisher", () => ({
	publishSolve: async () => {
		pushes++;
		throw Error("Synthetic publish boundary: must not execute");
	},
	publishGroup: async () => {
		pushes++;
		throw Error("Synthetic publish boundary: must not execute");
	},
}));
let head = "head";
let uncertain = false;
let duringPost: (() => void) | undefined;
let feedback: PRFeedbackEvent[] = [];
mock.module("../src/main/activity-queue/pr-eligibility", () => ({
	fetchQueuePRReviewEvidence: async () => ({ headSha: head, eligible: true }),
}));
mock.module("../src/main/activity-queue/pr-feedback-fetch", () => ({
	fetchPRFeedback: async () => feedback,
}));
mock.module("../src/main/github/auth", () => ({
	githubFetch: async (path: string, input: { body: string }) => {
		posts.push({ path, body: JSON.parse(input.body) });
		duringPost?.();
		if (uncertain) throw Error("Unknown transport outcome");
		return Response.json({});
	},
}));
mock.module("../src/main/providers/git-provider", () => ({
	getGitProvider: () => ({
		getPRState: async () => ({ headSha: head, state: "open" }),
		getReviewThreads: async (_owner: string, _repo: string, number: number) =>
			(number === 9 ? ["a", "b"] : ["thread"]).map((nodeId) => ({ nodeId, isResolved: false })),
		replyToComment: async (input: unknown) => {
			posts.push(input);
			return { id: "reply" };
		},
		resolveComment: async (input: unknown) => {
			posts.push(input);
		},
	}),
}));
const { ActivityQueueService } = await import("../src/main/activity-queue/service");
const queue = () => new ActivityQueueService();
const view = await import("../src/main/activity-queue/queue-view");
const { describePRQueueItem, observeScopedPRPoll } = await import(
	"../src/main/activity-queue/pr-source"
);
const { isPRQueueItemCurrent } = await import("../src/main/activity-queue/pr-scope");
const approvals = await import("../src/main/activity-queue/pr-actions");
const pub = await import("../src/main/activity-queue/pr-publication");
const { setDaemonClient } = await import("../src/main/terminal/daemon-instance");
const { workspaceSourceId } = await import("../src/main/activity-queue/agent-source");
function describeFixture(item: ActivityQueueItem): ExternalQueueItem {
	return {
		...item,
		category: item.kind === "project-hook" ? "hooks" : "tickets",
		situation: item.kind as "project-hook" | "ticket-start",
		subject: item.title,
		why: item.summary,
		clearsWhen: "Complete or dismiss",
		sourceLabel: "Synthetic fixture",
		nextAction: "Inspect",
		openLabel: "Open",
		detailLabel: "Context",
		evidence: [],
		context: { projectName: "Fixture", projectTint: 1 },
	};
}
beforeAll(() => {
	setupTestDb();
	view.registerExternalQueueAdapter(["pr-review", "pr-feedback"], {
		describe: describePRQueueItem,
		current: isPRQueueItemCurrent,
	});
	view.registerExternalQueueAdapter(["ticket-start", "project-hook"], {
		describe: describeFixture,
	});
});
beforeEach(async () => {
	const db = getDb();
	for (const table of [
		activityQueueSnoozes,
		activityQueueSources,
		sessionState,
		commentReplies,
		prComments,
		commentGroups,
		commentSolveSessions,
		terminalSessions,
		workspaces,
		worktrees,
		projects,
		githubAuth,
	])
		db.delete(table).run();
	posts = [];
	pushes = 0;
	head = "head";
	uncertain = false;
	duringPost = undefined;
	feedback = [];
	db.insert(githubAuth)
		.values({ id: "github", accountId: "me", accessToken: "synthetic-not-a-token" })
		.run();
	const now = new Date();
	db.insert(projects)
		.values({
			id: "project",
			name: "Fixture",
			repoPath: "/tmp/combined-publication",
			createdAt: now,
			updatedAt: now,
		})
		.run();
	db.insert(workspaces)
		.values({
			id: "workspace",
			projectId: "project",
			name: "Chat workspace",
			type: "branch",
			currentPhase: "blocked",
			needs: "Choose next step",
			createdAt: now,
			updatedAt: now,
		})
		.run();
	db.insert(terminalSessions)
		.values({
			id: "live",
			workspaceId: "workspace",
			title: "Chat",
			cwd: "/tmp/combined-publication",
			sortOrder: 0,
			updatedAt: now,
		})
		.run();
	setDaemonClient({
		isConnected: true,
		listSessionsStrict: async () => [{ id: "live", cwd: "/tmp/combined-publication", pid: 123 }],
	} as never);
	seed("review-a", "pr-review", 7);
	seed("feedback-b", "pr-feedback", 8);
	for (const id of ["ticket", "hook"])
		queue().observe({
			sourceId: id,
			sourceType: id,
			fingerprint: "first",
			snapshot: {},
			observedAt: Date.now(),
			candidate: {
				kind: id === "ticket" ? "ticket-start" : "project-hook",
				title: id,
				summary: "Inspect",
				occurredAt: Date.now(),
				reasons: [],
				target:
					id === "ticket"
						? {
								type: "ticket",
								provider: "linear",
								accountId: "me",
								siteId: "linear.app",
								ticketId: "ticket",
								identifier: "SUP-X",
								url: "https://linear.app/fixture",
								groupId: "team",
							}
						: { type: "project-hook", projectId: "project", hookId: "check", key: "key" },
			},
		});
	await view.listQueueView();
});
afterEach(() => {
	setDaemonClient(null);
	if (gitRoot) rmSync(gitRoot, { recursive: true, force: true });
	gitRoot = undefined;
});
function seed(
	id: string,
	kind: "pr-review" | "pr-feedback",
	number: number,
	fingerprint = "first"
) {
	const row = queue().observe({
		sourceId: id,
		sourceType: "pr",
		fingerprint,
		snapshot: {},
		observedAt: Date.now(),
		candidate: {
			kind,
			title: id,
			summary: "Inspect PR",
			occurredAt: Date.now(),
			reasons: [],
			target: {
				type: "pr",
				provider: "github",
				host: "github.com",
				accountId: "me",
				owner: "owner",
				repo: "repo",
				number,
			},
		},
	});
	return { id: row.sourceId, revision: row.revision };
}
function origin(id = "review-a") {
	return { id, revision: queue().read(id)!.revision };
}
function elapsed(family: "publication" | "review", requestId: string) {
	const key = `queue-pr-${family}:${requestId}`;
	const row = getDb().select().from(sessionState).where(eq(sessionState.key, key)).get()!;
	getDb()
		.update(sessionState)
		.set({ value: JSON.stringify({ ...JSON.parse(row.value), notBefore: Date.now() - 1 }) })
		.where(eq(sessionState.key, key))
		.run();
}
function unchangedBystanders() {
	for (const id of ["feedback-b", "ticket", "hook", workspaceSourceId("workspace")]) {
		const row = queue().read(id);
		expect(row?.candidate).toBeTruthy();
		expect(row?.acknowledgedRevision).toBeNull();
	}
}
const preparePub = (requestId: string, id = "review-a") =>
	pub.prepareQueuePRPublication({
		origin: origin(id),
		requestId,
		headSha: head,
		operation: { kind: "review", verdict: "COMMENT", body: "Reviewed" },
	});
const prepareApproval = (requestId: string) =>
	approvals.prepareQueuePRReview({ ...origin(), requestId, headSha: head, approveAnyway: false });
test("mixed PR/chat/ticket/hook view shares counts but concurrent approval paths reserve once", async () => {
	const list = await view.listQueueView();
	expect(list.totalPending).toBe(5);
	expect(list.items.map((i) => i.category).sort()).toEqual([
		"agents",
		"hooks",
		"prs",
		"prs",
		"tickets",
	]);
	const results = await Promise.allSettled([
		prepareApproval("approval"),
		preparePub("publication"),
	]);
	expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
	if (results[0]?.status === "fulfilled") {
		elapsed("review", "approval");
		expect((await approvals.dispatchQueuePRReview("approval")).status).toBe("submitted");
	} else {
		elapsed("publication", "publication");
		expect((await pub.dispatchQueuePRPublication("publication")).status).toBe("submitted");
	}
	expect(posts).toHaveLength(1);
	unchangedBystanders();
	expect((await view.listQueueView()).totalPending).toBe(4);
});
test("Done during publication delay rejects only that operation; Undo allows new explicit intent", async () => {
	const target = origin();
	await preparePub("pending");
	await view.queueViewDone(target);
	elapsed("publication", "pending");
	expect((await pub.dispatchQueuePRPublication("pending")).status).toBe("rejected");
	expect(posts).toHaveLength(0);
	unchangedBystanders();
	await view.queueViewUndoDone(target);
	await prepareApproval("retry");
	elapsed("review", "retry");
	expect((await approvals.dispatchQueuePRReview("retry")).status).toBe("submitted");
	expect(posts).toHaveLength(1);
	unchangedBystanders();
});
test("Later and changes in unrelated sources cannot cancel or acknowledge a review operation", async () => {
	await preparePub("review");
	await view.queueViewLater({ ...origin("ticket"), untilChange: true });
	await view.queueViewDone(origin("hook"));
	elapsed("publication", "review");
	expect((await pub.dispatchQueuePRPublication("review")).status).toBe("submitted");
	const list = await view.listQueueView();
	expect(list.totalPending).toBe(2);
	expect(list.laterCount).toBe(1);
	expect(queue().read("feedback-b")?.acknowledgedRevision).toBeNull();
	expect(queue().read(workspaceSourceId("workspace"))?.acknowledgedRevision).toBeNull();
	expect((await view.listQueueView({ view: "later" })).items.map((i) => i.id)).toEqual(["ticket"]);
});
test("a new PR occurrence during successful post survives cleanup and retry", async () => {
	const old = origin();
	await preparePub("review");
	elapsed("publication", "review");
	duringPost = () => seed("review-a", "pr-review", 7, "new-head");
	expect((await pub.dispatchQueuePRPublication("review")).status).toBe("submitted");
	expect(queue().read("review-a")?.revision).toBe(old.revision + 1);
	expect(queue().read("review-a")?.acknowledgedRevision).toBeNull();
	await pub.dispatchQueuePRPublication("review");
	expect(posts).toHaveLength(1);
	unchangedBystanders();
	expect((await view.listQueueView()).totalPending).toBe(5);
});
test("uncertain result blocks both paths only for its exact source/revision", async () => {
	await preparePub("review");
	elapsed("publication", "review");
	uncertain = true;
	expect((await pub.dispatchQueuePRPublication("review")).status).toBe("attempted");
	await expect(prepareApproval("again")).rejects.toThrow("unknown outcome");
	await expect(preparePub("again-other")).rejects.toThrow("unknown outcome");
	uncertain = false;
	await preparePub("other-pr", "feedback-b");
	pub.cancelQueuePRPublication("other-pr");
	unchangedBystanders();
	expect(queue().read("review-a")?.acknowledgedRevision).toBeNull();
	expect(posts).toHaveLength(1);
});
test("account switching during delay refuses PR post while local sources remain", async () => {
	await preparePub("review");
	elapsed("publication", "review");
	getDb().update(githubAuth).set({ accountId: "other-account" }).run();
	expect((await pub.dispatchQueuePRPublication("review")).status).toBe("rejected");
	expect(posts).toHaveLength(0);
	const list = await view.listQueueView();
	expect(list.totalPending).toBe(3);
	expect(list.items.map((i) => i.category).sort()).toEqual(["agents", "hooks", "tickets"]);
	unchangedBystanders();
});

const ownedPR: CachedPR = {
	provider: "github",
	identifier: "owner/repo#9",
	number: 9,
	title: "Owned PR",
	state: "open",
	sourceBranch: "feature",
	targetBranch: "main",
	author: { login: "me", avatarUrl: "" },
	reviewers: [],
	ciStatus: null,
	commentCount: 0,
	changedFiles: 0,
	additions: 0,
	deletions: 0,
	updatedAt: "",
	repoOwner: "owner",
	repoName: "repo",
	projectId: "project",
	role: "author",
	headCommitSha: "head",
};
async function pollOwned() {
	await observeScopedPRPoll(
		[ownedPR],
		new Map([
			[
				"github:owner/repo#9",
				{
					accountId: "me",
					authorAccountId: "me",
					state: "open" as const,
					headSha: "head",
					isDraft: false,
					reviewRequested: false,
				},
			],
		]),
		new Map()
	);
}
test("comment-only review on an owned PR does not resolve independent unanswered feedback", async () => {
	await pollOwned();
	feedback = [
		{
			id: "thread:a",
			authorId: "reviewer-a",
			author: "Reviewer A",
			body: "Fix A",
			at: Date.now(),
			threadId: "a",
		},
		{
			id: "thread:b",
			authorId: "reviewer-b",
			author: "Reviewer B",
			body: "Fix B",
			at: Date.now(),
			threadId: "b",
		},
	];
	await pollOwned();
	const item = (await view.listQueueView()).items.find(
		(i) => i.target.type === "pr" && i.target.number === 9
	)!;
	expect(item.kind).toBe("pr-feedback");
	await preparePub("own-comment", item.id);
	elapsed("publication", "own-comment");
	expect((await pub.dispatchQueuePRPublication("own-comment")).status).toBe("submitted");
	await pollOwned();
	expect((await view.listQueueView()).items.some((i) => i.id === item.id)).toBe(true);
	expect(queue().read(item.id)?.acknowledgedRevision).toBeNull();
	expect((await pub.dispatchQueuePRPublication("own-comment")).outcome?.verdictSubmitted).toBe(
		true
	);
	await expect(preparePub("duplicate-own-comment", item.id)).rejects.toThrow("reservation");
	await pub.prepareQueuePRPublication({
		origin: origin(item.id),
		requestId: "respond-thread",
		headSha: head,
		operation: { kind: "reply", commentId: "a", body: "Response to one thread" },
	});
	elapsed("publication", "respond-thread");
	expect((await pub.dispatchQueuePRPublication("respond-thread")).status).toBe("submitted");
	await pollOwned();
	expect((await view.listQueueView()).items.some((i) => i.id === item.id)).toBe(true);
	expect(posts).toHaveLength(2);
	unchangedBystanders();
});

function seedSolver() {
	gitRoot = mkdtempSync(join(tmpdir(), "queue-combined-solve-"));
	const git = (...args: string[]) =>
		execFileSync("git", args, { cwd: gitRoot, encoding: "utf8" }).trim();
	git("init", "-q", "-b", "feature");
	writeFileSync(join(gitRoot, "fixture.txt"), "Synthetic\n");
	git("add", "fixture.txt");
	git(
		"-c",
		"user.name=Fixture",
		"-c",
		"user.email=fixture@example.invalid",
		"commit",
		"-qm",
		"fixture"
	);
	git("remote", "add", "origin", "git@github.com:owner/repo.git");
	head = git("rev-parse", "HEAD");
	const now = new Date();
	const db = getDb();
	db.insert(worktrees)
		.values({
			id: "solve-wt",
			projectId: "project",
			path: gitRoot,
			branch: "feature",
			baseBranch: "main",
			createdAt: now,
			updatedAt: now,
		})
		.run();
	db.update(workspaces)
		.set({ worktreeId: "solve-wt", prProvider: "github", prIdentifier: "owner/repo#8" })
		.where(eq(workspaces.id, "workspace"))
		.run();
	db.insert(commentSolveSessions)
		.values({
			id: "solve",
			workspaceId: "workspace",
			prProvider: "github",
			prIdentifier: "owner/repo#8",
			prTitle: "Own PR",
			sourceBranch: "feature",
			targetBranch: "main",
			status: "ready",
			commitSha: head,
			createdAt: now,
			updatedAt: now,
		})
		.run();
	db.insert(sessionState)
		.values({
			key: "comment-solve-scope:solve",
			value: JSON.stringify([
				"workspace",
				"github",
				"github.com",
				"me",
				"owner/repo#8",
				"feedback-b",
				origin("feedback-b").revision,
			]),
		})
		.run();
	for (const id of ["a", "b"]) {
		db.insert(commentGroups)
			.values({ id, solveSessionId: "solve", label: id, status: "approved", order: 0 })
			.run();
		db.insert(prComments)
			.values({
				id,
				solveSessionId: "solve",
				groupId: id,
				platformCommentId: `queue-feedback:${id}`,
				threadId: "thread",
				author: "Reviewer",
				body: id,
				filePath: "fixture.txt",
				status: "fixed",
			})
			.run();
		db.insert(commentReplies)
			.values({ id, prCommentId: id, body: `Approved ${id}`, status: "approved" })
			.run();
	}
}
test("two real solver group snapshots and review replies share exact occurrence reservation", async () => {
	seedSolver();
	const input = (requestId: string, groupId: string) =>
		pub.prepareQueuePRPublication({
			origin: origin("feedback-b"),
			requestId,
			headSha: head,
			operation: { kind: "solve", sessionId: "solve", groupId },
		});
	const results = await Promise.allSettled([input("group-a", "a"), input("group-b", "b")]);
	expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
	await expect(
		pub.prepareQueuePRPublication({
			origin: origin("feedback-b"),
			requestId: "reply",
			headSha: head,
			operation: { kind: "reply", commentId: "thread", body: "Response" },
		})
	).rejects.toThrow("reservation");
	const winning = results[0]?.status === "fulfilled" ? "group-a" : "group-b";
	pub.cancelQueuePRPublication(winning);
	await prepareApproval("other-review");
	approvals.cancelQueuePRReview("other-review");
	await input("after-undo", "b");
	await view.queueViewDone(origin("feedback-b"));
	elapsed("publication", "after-undo");
	expect((await pub.dispatchQueuePRPublication("after-undo")).status).toBe("rejected");
	expect(pushes).toBe(0);
	expect(posts).toHaveLength(0);
	expect(queue().read("review-a")?.acknowledgedRevision).toBeNull();
	expect(queue().read("ticket")?.acknowledgedRevision).toBeNull();
	expect(queue().read("hook")?.acknowledgedRevision).toBeNull();
});

test("legacy submitted verdict receipts without resolution metadata remain conservative", async () => {
	await preparePub("legacy", "feedback-b");
	elapsed("publication", "legacy");
	expect((await pub.dispatchQueuePRPublication("legacy")).status).toBe("submitted");
	const key = "queue-pr-publication:legacy";
	const row = getDb().select().from(sessionState).where(eq(sessionState.key, key)).get()!;
	const receipt = JSON.parse(row.value);
	delete receipt.resolvesOccurrence;
	getDb()
		.update(sessionState)
		.set({ value: JSON.stringify(receipt) })
		.where(eq(sessionState.key, key))
		.run();
	await expect(
		pub.prepareQueuePRPublication({
			origin: origin("feedback-b"),
			requestId: "legacy-different-response",
			headSha: head,
			operation: { kind: "reply", commentId: "thread", body: "A new response" },
		})
	).rejects.toThrow("reservation");
	expect(posts).toHaveLength(1);
	unchangedBystanders();
});
