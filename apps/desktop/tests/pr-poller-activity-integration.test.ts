import "./preload-electron-mock";
import { beforeAll, expect, spyOn, test } from "bun:test";
import { ActivityQueueService } from "../src/main/activity-queue/service";
import {
	getCachedPRs,
	onNewPRDetected,
	onPRClosedDetected,
	onPRCommitChanged,
	refreshNow,
} from "../src/main/ai-review/pr-poller";
import { getDb } from "../src/main/db";
import { reviewDrafts, trackedPrs } from "../src/main/db/schema";
import { activityQueueSources } from "../src/main/db/schema-activity-queue";
import { registerGitProvider } from "../src/main/providers/git-provider";
import type { GitProvider, NormalizedPR, PRState } from "../src/main/providers/types";
import { setupTestDb } from "./helpers/db";
beforeAll(setupTestDb);
test("real poll persists baseline, coalesces, preserves unknown head, confirms disappearance, and keeps callbacks", async () => {
	const db = getDb();
	db.delete(trackedPrs).run();
	db.delete(activityQueueSources).run();
	db.delete(reviewDrafts).run();
	const queue = new ActivityQueueService();
	let now = 1_000_000;
	const clock = spyOn(Date, "now").mockImplementation(() => now);
	let connected = true;
	let calls = 0;
	let failList = false;
	let failState = false;
	let listed: NormalizedPR[] = ["one", "two"].map((repo) => ({
		id: 1,
		repoOwner: "o",
		repoName: repo,
		title: repo,
		state: "open",
		author: "a",
		webUrl: "",
		sourceBranch: "feat",
		targetBranch: "main",
		role: "reviewer",
		headCommitSha: "a",
		activity: { state: "open", headSha: "a", isDraft: false, reviewRequested: true },
	}));
	let state: PRState = { state: "open", headSha: "", activity: { state: "open" } };
	const events: string[] = [];
	onNewPRDetected((pr) => events.push(`new:${pr.identifier}`));
	onPRClosedDetected((pr) => events.push(`closed:${pr.identifier}`));
	onPRCommitChanged((pr) => events.push(`head:${pr.identifier}`));
	registerGitProvider({
		name: "github",
		isConnected: () => connected,
		getMyPRs: async () => {
			calls++;
			if (failList) throw new Error("offline");
			return listed;
		},
		getPRState: async () => {
			if (failState) throw new Error("not found or inaccessible");
			return state;
		},
	} as unknown as GitProvider);
	try {
		await Promise.all([refreshNow(), refreshNow()]);
		expect(calls).toBe(1);
		expect(getCachedPRs()).toHaveLength(2);
		expect(queue.list().totalPending).toBe(2);
		expect(events).toEqual([]);
		for (const item of queue.list().items)
			queue.acknowledge({ id: item.id, revision: item.revision });
		now++;
		await refreshNow();
		expect(queue.list().totalPending).toBe(0);
		listed = listed.map((pr) => ({
			...pr,
			headCommitSha: "",
			activity: { state: "open" as const },
		}));
		now++;
		await refreshNow();
		expect(getCachedPRs().every((pr) => pr.headCommitSha === "a")).toBe(true);
		expect(queue.list().totalPending).toBe(0);
		listed = listed.map((pr) => ({
			...pr,
			headCommitSha: "b",
			activity: { state: "open" as const, headSha: "b", isDraft: false, reviewRequested: true },
		}));
		now++;
		await refreshNow();
		expect(queue.list().totalPending).toBe(2);
		expect(events.filter((e) => e.startsWith("head:"))).toHaveLength(2);
		failList = true;
		now++;
		await refreshNow();
		expect(queue.list().totalPending).toBe(2);
		expect(queue.list().items.every((i) => i.stale)).toBe(true);
		failList = false;
		listed = [];
		failState = true;
		now += 400_000;
		await refreshNow();
		expect(getCachedPRs().every((pr) => pr.state === "open")).toBe(true);
		expect(queue.list().totalPending).toBe(2);
		failState = false;
		state = { state: "merged", headSha: "b", activity: { state: "merged" } };
		now += 60_000;
		await refreshNow();
		expect(queue.list().totalPending).toBe(0);
		expect(getCachedPRs().every((pr) => pr.state === "merged")).toBe(true);
		expect(events.filter((e) => e.startsWith("closed:"))).toHaveLength(2);
		// Ready draft outside remote search is checked before surfacing; provenance is read-only.
		db.insert(reviewDrafts)
			.values({
				id: "manual",
				prProvider: "github",
				prIdentifier: "o/unlisted#3",
				prTitle: "Unlisted",
				prAuthor: "a",
				sourceBranch: "f",
				targetBranch: "main",
				status: "ready",
				commitSha: "reviewed-sha",
				createdAt: new Date(),
				updatedAt: new Date(),
			})
			.run();
		state = {
			state: "open",
			headSha: "current-sha",
			activity: { state: "open", isDraft: false, reviewRequested: false },
		};
		now++;
		await refreshNow();
		expect(queue.list().items[0]?.summary).toBe("Review draft ready");
		expect(db.select().from(reviewDrafts).get()?.commitSha).toBe("reviewed-sha");
	} finally {
		connected = false;
		clock.mockRestore();
		onNewPRDetected(() => {});
		onPRClosedDetected(() => {});
		onPRCommitChanged(() => {});
	}
});
