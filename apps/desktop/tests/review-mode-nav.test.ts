import { beforeEach, describe, expect, test } from "bun:test";
import { openThreadInChanges, openThreadInComments } from "../src/renderer/lib/review-mode-nav";
import {
	prReviewSessionKey,
	usePRReviewSessionStore,
} from "../src/renderer/stores/pr-review-session-store";
import { useReviewModeStore } from "../src/renderer/stores/review-mode-store";
import type { PRContext } from "../src/shared/github-types";
import { formatPrIdentifier } from "../src/shared/pr-identifier";

const prCtx: PRContext = {
	provider: "github",
	owner: "owner",
	repo: "repo",
	number: 42,
	title: "Review navigation",
	sourceBranch: "feature",
	targetBranch: "main",
	repoPath: "/tmp/repo",
};

const sessionKey = prReviewSessionKey("workspace-1", formatPrIdentifier(prCtx));

function reset(): void {
	usePRReviewSessionStore.setState({ sessions: new Map() });
	useReviewModeStore.setState({
		active: null,
		lastWorkspaceId: null,
		view: "overview",
		commentFilter: "attention",
		publishedCommentsVisible: false,
		intent: null,
	});
}

describe("review mode thread navigation", () => {
	beforeEach(reset);

	test("opening a thread in Changes selects it and makes published comments visible", () => {
		openThreadInChanges("workspace-1", prCtx, "src/a.ts", "thread-1");

		const review = useReviewModeStore.getState();
		const session = usePRReviewSessionStore.getState().sessions.get(sessionKey);
		expect(review.active).toEqual({ workspaceId: "workspace-1", prCtx });
		expect(review.view).toBe("changes");
		expect(review.publishedCommentsVisible).toBe(true);
		expect(session?.activeFilePath).toBe("src/a.ts");
		expect(session?.activeThreadId).toBe("thread-1");
	});

	test("returning to Comments preserves the filter and selected thread", () => {
		useReviewModeStore.getState().open("workspace-1", prCtx);
		useReviewModeStore.getState().setCommentFilter("attention");
		openThreadInComments("workspace-1", prCtx, "src/b.ts", "thread-2");

		const review = useReviewModeStore.getState();
		const session = usePRReviewSessionStore.getState().sessions.get(sessionKey);
		expect(review.view).toBe("comments");
		expect(review.commentFilter).toBe("attention");
		expect(session?.activeFilePath).toBe("src/b.ts");
		expect(session?.activeThreadId).toBe("thread-2");
	});
});
