import { describe, expect, test } from "bun:test";
import { createReviewPathRuntime } from "../src/main/review-path/execution";
import type { ReviewPathRun } from "../src/shared/review-path-runtime";
const run: ReviewPathRun = {
	id: "map-1",
	version: 1,
	kind: "mapping",
	state: "running",
	conversationId: "conversation",
	identity: {
		workspaceId: "ws",
		provider: "github",
		owner: "org",
		repo: "repo",
		prNumber: 1,
		headSha: "a".repeat(40),
	},
};
function harness() {
	let current = structuredClone(run);
	const launched: string[] = [];
	const stopped: string[] = [];
	const failures: string[] = [];
	const prompts: string[] = [];
	const runtime = createReviewPathRuntime({
		getRun: () => current,
		fail: (_run, error) => {
			failures.push(error);
			current = { ...current, state: "failed" };
		},
		prepare: async (scope, prompt) => {
			prompts.push(prompt);
			return {
				terminalId: `review-path:${scope.id}:${scope.version}`,
				reviewWorkspaceId: "ws",
				worktreePath: "/repo",
				launchScript: "/launch",
				cliPreset: "codex" as const,
			};
		},
		launch: async (descriptor) => {
			launched.push(descriptor.terminalId);
		},
		stop: async (id) => {
			stopped.push(id);
		},
	});
	return {
		runtime,
		launched,
		stopped,
		failures,
		prompts,
		setRun: (value: ReviewPathRun) => {
			current = value;
		},
	};
}
describe("owned reading path execution", () => {
	test("duplicate starts reuse the exact owned launch, never another terminal", async () => {
		const h = harness();
		const input = { run, agent: { id: "codex", label: "Codex" }, alsoReview: false };
		const [a, b] = await Promise.all([
			h.runtime.startMapping(input),
			h.runtime.startMapping(input),
		]);
		expect(a).toEqual(b);
		expect(h.launched).toEqual(["review-path:map-1:1"]);
		await h.runtime.stopMapping({ run });
		expect(h.stopped).toEqual(["review-path:map-1:1"]);
	});
	test("superseded launch never reaches a terminal", async () => {
		const h = harness();
		h.setRun({ ...run, state: "superseded" });
		await expect(
			h.runtime.startMapping({ run, agent: { id: "codex", label: "Codex" }, alsoReview: false })
		).rejects.toThrow("no longer active");
		expect(h.launched).toEqual([]);
	});
	test("Ask prompt carries exact head, question correlation and explicit anchor", async () => {
		const h = harness();
		const qrun = { ...run, id: "ask-1", kind: "question" as const, questionId: "q1" };
		h.setRun(qrun);
		await h.runtime.ask({
			run: qrun,
			question: {
				id: "q1",
				conversationId: "conversation",
				runId: "ask-1",
				state: "pending",
				message: {
					id: "q1",
					role: "user",
					text: "Why?",
					createdAt: new Date().toISOString(),
					anchor: { path: "src/a.ts", side: "LEFT", startLine: 2, endLine: 4 },
				},
			},
		});
		expect(h.prompts[0]).toContain(run.identity.headSha);
		expect(h.prompts[0]).toContain('"questionId":"q1"');
		expect(h.prompts[0]).toContain('"side":"LEFT"');
		expect(h.prompts[0]).toContain("First call get_review_path");
		expect(h.prompts[0]).toContain("run.conversationId");
		expect(h.prompts[0]).toContain("matching headSha");
		await h.runtime.cancelQuestion({ run: qrun });
		expect(h.stopped).toEqual(["review-path:ask-1:1"]);
	});
	test("mismatched questions never launch", async () => {
		const h = harness();
		await expect(
			h.runtime.ask({
				run,
				question: {
					id: "wrong",
					conversationId: "other",
					runId: "other",
					state: "pending",
					message: { id: "wrong", role: "user", text: "Why?", createdAt: "now" },
				},
			})
		).rejects.toThrow("Question identity");
		expect(h.launched).toEqual([]);
	});
});

test("cancellation while preparing prevents a late launch", async () => {
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const launched: string[] = [];
	const runtime = createReviewPathRuntime({
		getRun: () => run,
		fail: () => {},
		prepare: async () => {
			await gate;
			return {
				terminalId: "review-path:map-1:1",
				reviewWorkspaceId: "ws",
				worktreePath: "/repo",
				launchScript: "/launch",
				cliPreset: "claude",
			};
		},
		launch: async (d) => {
			launched.push(d.terminalId);
		},
		stop: async () => {},
	});
	const pending = runtime.startMapping({
		run,
		agent: { id: "claude", label: "Claude Code" },
		alsoReview: false,
	});
	await runtime.stopMapping({ run });
	release();
	await expect(pending).rejects.toThrow("no longer active");
	expect(launched).toEqual([]);
});
test("runner offline records an explicit failure without generating an answer", async () => {
	const failures: string[] = [];
	const runtime = createReviewPathRuntime({
		getRun: () => run,
		fail: (_r, e) => {
			failures.push(e);
		},
		prepare: async () => {
			throw new Error("offline");
		},
		launch: async () => {},
		stop: async () => {},
	});
	await expect(
		runtime.startMapping({ run, agent: { id: "codex", label: "Codex" }, alsoReview: false })
	).rejects.toThrow("offline");
	expect(failures).toEqual(["offline"]);
});
test("stop rejects a foreign persisted terminal selector", async () => {
	const h = harness();
	await expect(
		h.runtime.stopMapping({ run: { ...run, terminalId: "user-review-terminal" } })
	).rejects.toThrow("ownership");
	expect(h.stopped).toEqual([]);
});

test("agent exit after durable completion does not turn a ready path into a failure", async () => {
	let current = run;
	const failures: string[] = [];
	let exit!: (code: number) => void;
	const runtime = createReviewPathRuntime({
		getRun: () => current,
		fail: (_run, error) => {
			failures.push(error);
		},
		prepare: async () => ({
			terminalId: "review-path:map-1:1",
			reviewWorkspaceId: "ws",
			worktreePath: "/repo",
			launchScript: "/launch",
			cliPreset: "codex",
		}),
		launch: async (_launch, onExit) => {
			exit = onExit;
		},
		stop: async () => {},
	});
	await runtime.startMapping({ run, agent: { id: "codex", label: "Codex" }, alsoReview: false });
	current = { ...run, state: "completed" };
	exit(0);
	expect(failures).toEqual([]);
});
