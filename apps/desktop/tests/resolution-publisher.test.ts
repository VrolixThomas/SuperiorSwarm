import { describe, expect, test } from "bun:test";
import { groupRepliesByThread } from "../src/main/ai-review/resolution-publisher";

describe("groupRepliesByThread", () => {
	test("groups GitHub comments by thread ID", () => {
		const comments = [
			{ platformThreadId: "thread-1", platformCommentId: "c1", groupId: "g1" },
			{ platformThreadId: "thread-1", platformCommentId: "c2", groupId: "g1" },
			{ platformThreadId: "thread-2", platformCommentId: "c3", groupId: "g2" },
		];
		const groups = groupRepliesByThread(comments as any);
		expect(Object.keys(groups)).toHaveLength(2);
		expect(groups["thread-1"]).toHaveLength(2);
		expect(groups["thread-2"]).toHaveLength(1);
	});

	test("falls back to platformCommentId for Bitbucket (no thread)", () => {
		const comments = [
			{ platformThreadId: null, platformCommentId: "bb-1", groupId: "g1" },
			{ platformThreadId: null, platformCommentId: "bb-2", groupId: "g1" },
		];
		const groups = groupRepliesByThread(comments as any);
		expect(Object.keys(groups)).toHaveLength(2);
	});
});
