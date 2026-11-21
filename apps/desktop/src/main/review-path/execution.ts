import type { CliPresetName } from "../../shared/cli-preset";
import type { ReviewPathRun, ReviewPathRuntimePort } from "../../shared/review-path-runtime";
import { buildMappingPrompt, buildQuestionPrompt } from "./prompt";

export interface OwnedReviewPathLaunch {
	terminalId: string;
	reviewWorkspaceId: string;
	worktreePath: string;
	launchScript: string;
	cliPreset: CliPresetName;
}
export interface ReviewPathExecutionDeps {
	getRun: (id: string) => ReviewPathRun | null | undefined;
	fail: (run: ReviewPathRun, error: string) => void;
	prepare: (
		run: ReviewPathRun,
		prompt: string,
		agentId?: string,
		alsoReview?: boolean
	) => Promise<OwnedReviewPathLaunch>;
	launch: (launch: OwnedReviewPathLaunch, onExit: (code: number) => void) => Promise<void>;
	stop: (terminalId: string) => Promise<void>;
}
export function ownedTerminalId(run: ReviewPathRun): string {
	return `review-path:${run.id}:${run.version}`;
}
export function sameActiveRun(
	current: ReviewPathRun | null | undefined,
	run: ReviewPathRun
): boolean {
	return (
		!!current &&
		current.id === run.id &&
		current.version === run.version &&
		current.state === "running" &&
		Object.entries(run.identity).every(
			([key, value]) => current.identity[key as keyof typeof run.identity] === value
		)
	);
}
/** Durable storage fences writes; this layer fences launches and cancellation independently. */
export function createReviewPathRuntime(deps: ReviewPathExecutionDeps): ReviewPathRuntimePort {
	const launches = new Map<string, Promise<OwnedReviewPathLaunch>>();
	const cancelled = new Set<string>();
	const key = (run: ReviewPathRun) => ownedTerminalId(run);
	function active(run: ReviewPathRun) {
		return !cancelled.has(key(run)) && sameActiveRun(deps.getRun(run.id), run);
	}
	async function start(run: ReviewPathRun, prompt: string, agentId?: string, alsoReview = false) {
		const id = key(run);
		const existing = launches.get(id);
		if (existing) return existing;
		if (!active(run)) throw new Error("Reading-path run is no longer active");
		const pending = (async () => {
			try {
				const launch = await deps.prepare(run, prompt, agentId, alsoReview);
				if (launch.terminalId !== id) throw new Error("Unexpected reading-path terminal ownership");
				if (!active(run)) throw new Error("Reading-path run is no longer active");
				await deps.launch(launch, (code) => {
					if (active(run)) deps.fail(run, `Agent exited before recording a result (exit ${code})`);
				});
				if (!active(run)) await deps.stop(id);
				return launch;
			} catch (error) {
				if (active(run)) deps.fail(run, error instanceof Error ? error.message : String(error));
				throw error;
			}
		})();
		launches.set(id, pending);
		return pending;
	}
	async function stop({ run }: { run: ReviewPathRun }) {
		cancelled.add(key(run));
		// Never trust a persisted terminal selector without verifying deterministic ownership.
		if (run.terminalId && run.terminalId !== key(run))
			throw new Error("Unexpected reading-path terminal ownership");
		await deps.stop(key(run));
	}
	return {
		startMapping: ({ run, agent, alsoReview }) =>
			start(run, buildMappingPrompt(run, alsoReview), agent.id, alsoReview),
		stopMapping: stop,
		ask: ({ run, question }) => {
			if (
				run.kind !== "question" ||
				run.questionId !== question.id ||
				run.id !== question.runId ||
				run.conversationId !== question.conversationId ||
				question.state !== "pending"
			)
				return Promise.reject(new Error("Question identity does not match its owned run"));
			return start(run, buildQuestionPrompt(run, question));
		},
		cancelQuestion: stop,
	};
}

/** Reconcile only after a successful daemon inventory; offline is not proof of process death. */
export function reconcileReviewPathRuns(
	runs: ReviewPathRun[],
	terminalIds: string[],
	fail: (run: ReviewPathRun, error: string) => void
): void {
	const live = new Set(terminalIds);
	for (const run of runs) {
		if (run.state !== "running") continue;
		if (run.terminalId && run.terminalId !== ownedTerminalId(run)) {
			fail(run, "Reading-path terminal ownership mismatch");
			continue;
		}
		if (!live.has(ownedTerminalId(run)))
			fail(
				run,
				"Reading-path agent was interrupted before recording a result; retry to start a new run"
			);
	}
}
