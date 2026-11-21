import { expect, test } from "bun:test";
import { selectAskConversation } from "../src/renderer/components/review-mode/panel/useAskAgent";
import type {
	ReviewPathIdentity,
	ReviewPathQuestion,
	ReviewPathRun,
	ReviewPathSnapshot,
} from "../src/shared/review-path-runtime";
const identity: ReviewPathIdentity = {
	workspaceId: "w",
	provider: "github",
	owner: "o",
	repo: "r",
	prNumber: 1,
	headSha: "a".repeat(40),
};
const anchor = { path: "a.ts", side: "LEFT" as const, startLine: 2, endLine: 3 };
function pair(
	id: string,
	conversationId: string,
	headSha = identity.headSha
): { run: ReviewPathRun; question: ReviewPathQuestion } {
	return {
		run: {
			id: `run-${id}`,
			version: 1,
			kind: "question",
			state: "completed",
			identity: { ...identity, headSha },
			conversationId,
			questionId: id,
		},
		question: {
			id,
			conversationId,
			runId: `run-${id}`,
			state: "answered",
			message: { id: `user-${id}`, role: "user", text: id, anchor, createdAt: "now" },
			answer: { id: `answer-${id}`, role: "agent", text: `answer ${id}`, createdAt: "now" },
		},
	};
}
function snapshot(pairs: ReturnType<typeof pair>[]): ReviewPathSnapshot {
	return {
		identity,
		path: null,
		pathVersion: 0,
		conversationId: "current",
		runs: pairs.map((p) => p.run),
		questions: pairs.map((p) => p.question),
		messages: pairs.flatMap((p) =>
			p.question.answer ? [p.question.message, p.question.answer] : [p.question.message]
		),
	};
}
test("Ask only exposes current conversation and exact head; answer inherits correlated selection anchor", () => {
	const state = selectAskConversation(
		snapshot([
			pair("old", "previous"),
			pair("old-head", "current", "b".repeat(40)),
			pair("new", "current"),
		])
	);
	expect(state.questions.map((q) => q.id)).toEqual(["new"]);
	expect(state.messages.map((m) => m.text)).toEqual(["new", "answer new"]);
	expect(state.messages[1]?.anchor).toEqual(anchor);
});
test("old failures do not override a new pending question", () => {
	const old = pair("failed", "current");
	old.question.state = "failed";
	old.question.error = "old error";
	old.question.answer = undefined;
	const pending = pair("pending", "current");
	pending.run.state = "running";
	pending.question.state = "pending";
	pending.question.answer = undefined;
	const state = selectAskConversation(snapshot([old, pending]));
	expect(state.pending).toBe(true);
	expect(state.error).toBeUndefined();
	expect(state.messages.every((m) => m.role === "user")).toBe(true);
});
