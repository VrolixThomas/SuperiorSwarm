import { expect, mock, test } from "bun:test";
import { inIsolatedFileBrowserTest } from "./helpers/isolated-file-browser-test";

if (
	inIsolatedFileBrowserTest(
		import.meta.path,
		"automatic mapping accepts a durable job before preparation"
	)
) {
	const { makeTestDb } = await import("./test-db");
	const { _setDbForTesting } = await import("../src/main/db");
	const schema = await import("../src/main/db/schema");
	const db = makeTestDb();
	const now = new Date();
	db.insert(schema.projects)
		.values({
			id: "p",
			name: "Fixture",
			repoPath: "/tmp/review-job-fixture",
			createdAt: now,
			updatedAt: now,
		})
		.run();
	_setDbForTesting(db);
	const accepted: Array<Record<string, unknown>> = [];
	let job: import("../src/shared/review-agent-job").ReviewAgentJob | undefined;
	mock.module("../src/main/review-path/runtime", () => ({
		initializeReviewPathRuntime: async () => {},
	}));
	mock.module("../src/main/ai-review/orchestrator", () => ({
		getReviewDrafts: () => [],
		getReviewDraft: () => undefined,
		getSettings: () => ({ cliPreset: "codex" }),
	}));
	mock.module("../src/main/review-path/service", () => ({
		getReviewPathStorage: () => ({
			getSettings: () => ({ autoMapOnReviewRequest: true, alsoReview: true }),
		}),
		getReviewPathApplication: () => ({
			jobs: () => (job ? [job] : []),
			startJob: (input: import("../src/shared/review-agent-job").StartReviewAgentJobInput) => {
				accepted.push({ ...input });
				job = {
					...input,
					id: "accepted-job",
					kind: "mapping",
					state: "queued",
					phase: "queued",
					startedAt: now.toISOString(),
					updatedAt: now.toISOString(),
					attempt: 1,
					trigger: "auto",
					activity: [],
				};
				return job;
			},
		}),
	}));
	const { maybeAutoMap } = await import("../src/main/review-path/auto-map-runtime");
	test("logical workspace and queued job suppress competing legacy launch without claiming completed work", async () => {
		const pr = {
			provider: "github",
			identifier: "o/r#1",
			repoOwner: "o",
			repoName: "r",
			number: 1,
			headCommitSha: "a".repeat(40),
			projectId: "p",
			role: "reviewer",
			state: "open",
			title: "PR",
			sourceBranch: "feature",
			targetBranch: "main",
		} as import("../src/shared/review-types").CachedPR;
		let marked = 0;
		const ledger = {
			get: () => ({ firstTriggeredAt: null }),
			markFirstTriggered: () => {
				marked++;
			},
		} as unknown as import("../src/main/ai-review/auto-trigger").AutoReviewLedger;
		expect(await maybeAutoMap(pr, ledger)).toBe(true);
		expect(await maybeAutoMap(pr, ledger)).toBe(true);
		expect(accepted).toHaveLength(1);
		expect(accepted[0]?.["trigger"]).toBe("auto");
		expect(db.select().from(schema.workspaces).get()?.worktreeId).toBeNull();
		expect(db.select().from(schema.worktrees).all()).toHaveLength(0);
		expect(marked).toBe(0);
	});
}
