import type { GitHubPRDetails } from "../../shared/github-types";
import {
	type ReviewAgentJob,
	type StartReviewAgentJobInput,
	isReviewAgentJobActive,
	reviewAgentQuestionId,
} from "../../shared/review-agent-job";
import type {
	ReviewPathIdentity,
	ReviewPathRunScope,
	ReviewPathRuntimePort,
} from "../../shared/review-path-runtime";
import type { ReviewPath } from "../../shared/review-path-types";
import type { ReviewPathStorage } from "./storage";
import { questionInputSchema } from "./validation";

export interface ReviewPathApplicationDeps {
	metadataTimeoutMs?: number;
	storage: ReviewPathStorage;
	runtime: () => ReviewPathRuntimePort;
	/** Main-process provider read and registered workspace check, never fixture data. */
	resolve: (
		identity: ReviewPathIdentity
	) => Promise<{ identity: ReviewPathIdentity; changedFiles: string[]; details?: GitHubPRDetails }>;
	validateWorkspace: (identity: ReviewPathIdentity) => void;
}
export class ReviewPathApplication {
	constructor(readonly deps: ReviewPathApplicationDeps) {}
	jobs(workspaceId: string) {
		const jobs = this.deps.storage.jobs(workspaceId);
		for (const job of jobs) this.deps.validateWorkspace(job.identity);
		return jobs;
	}
	startJob(input: StartReviewAgentJobInput) {
		return this.acceptJob(input);
	}
	askJob(input: Omit<StartReviewAgentJobInput, "alsoReview"> & { question: unknown }) {
		return this.acceptJob(
			{ ...input, alsoReview: false },
			questionInputSchema.parse(input.question)
		);
	}
	private acceptJob(input: StartReviewAgentJobInput, question?: ReviewAgentJob["question"]) {
		this.deps.validateWorkspace(input.identity);
		if (!input.requestId || input.requestId.length > 256) throw new Error("Invalid job request ID");
		if (!["codex", "claude", "claude-code"].includes(input.agent.id))
			throw new Error("Unsupported review agent");
		const { job, accepted } = this.deps.storage.acceptJob(input, question);
		if (accepted) {
			// Persist and return before any network/PTY work. The captured job owns its
			// identity even if the renderer navigates to another PR in the meantime.
			setTimeout(() => {
				void this.executeJob(job, job.alsoReview ?? input.alsoReview);
			}, 0);
		}
		return job;
	}
	private jobActive(job: ReviewAgentJob) {
		return this.deps.storage
			.jobs(job.identity.workspaceId)
			.some((j) => j.id === job.id && j.attempt === job.attempt && isReviewAgentJobActive(j));
	}
	private async resolveJob(job: ReviewAgentJob) {
		let timer: ReturnType<typeof setTimeout> | undefined;
		let fence: ReturnType<typeof setInterval> | undefined;
		try {
			const interrupted = new Promise<never>((_resolve, reject) => {
				timer = setTimeout(
					() => reject(new Error("PR metadata timed out. Retry to check this revision again.")),
					this.deps.metadataTimeoutMs ?? 60_000
				);
				fence = setInterval(() => {
					if (!this.jobActive(job)) reject(new Error("Review job is no longer active"));
				}, 100);
				timer.unref?.();
				fence.unref?.();
			});
			return await Promise.race([this.deps.resolve(job.identity), interrupted]);
		} finally {
			clearTimeout(timer);
			clearInterval(fence);
		}
	}
	private async executeJob(job: ReviewAgentJob, alsoReview: boolean) {
		const storage = this.deps.storage;
		try {
			if (!this.jobActive(job)) return;
			storage.updateJob(
				job,
				{ state: "preparing", phase: "metadata" },
				"Checking pull request revision"
			);
			const generation = storage.reserveMetadata(job.identity);
			const resolved = await this.resolveJob(job);
			if (!this.jobActive(job)) return;
			this.deps.validateWorkspace(job.identity);
			if (!storage.acceptJobMetadata(job.identity, resolved.identity, generation))
				throw new Error(
					"Request superseded by a newer PR observation. Retry with the current revision."
				);
			if (resolved.identity.headSha !== job.identity.headSha)
				throw new Error("PR head changed. Refresh the PR before retrying.");
			const before = storage.peek(job.identity);
			const runtime = this.deps.runtime();
			const questionResult = job.question
				? storage.enqueueQuestion(job.identity, {
						...job.question,
						id: reviewAgentQuestionId(job),
					})
				: undefined;
			const run =
				questionResult?.run ??
				storage.begin(job.identity, job.agent, resolved.changedFiles, { alsoReview });
			storage.updateJob(
				job,
				{ runId: run.id, runVersion: run.version, phase: "worktree" },
				"Preparing isolated agent workspace"
			);
			for (const old of before.runs)
				if (old.state === "running" && storage.getRun(old.id)?.state !== "running") {
					try {
						if (old.kind === "mapping") await runtime.stopMapping({ run: old });
						else await runtime.cancelQuestion({ run: old });
					} catch {
						/* already fenced */
					}
				}
			if (!this.jobActive(job)) return;
			const launch = questionResult
				? await runtime.ask({
						run,
						question: questionResult.question,
						agent: job.agent,
						metadata: resolved.details,
					})
				: await runtime.startMapping({
						run,
						agent: job.agent,
						alsoReview,
						metadata: resolved.details,
					});
			if (!this.jobActive(job) || storage.getRun(run.id)?.state !== "running") return;
			if (launch?.terminalId) storage.attachTerminal(run, launch.terminalId);
			storage.updateJob(
				job,
				{
					state: "running",
					phase: job.kind === "mapping" ? "mapping" : "answering",
					terminalId: launch?.terminalId,
					cwd: launch?.worktreePath,
				},
				job.kind === "mapping" ? "Agent is mapping this PR" : "Agent is answering your question"
			);
		} catch (error) {
			if (!this.jobActive(job)) return;
			const message = error instanceof Error ? error.message : "Agent preparation failed";
			const current = storage.jobs(job.identity.workspaceId).find((j) => j.id === job.id);
			const run = current?.runId ? storage.getRun(current.runId) : undefined;
			if (run?.state === "running") storage.fail(run, message);
			storage.updateJob(job, { state: "failed", phase: "failed", error: message }, message);
		}
	}
	async cancelJob(workspaceId: string, jobId: string) {
		const job = this.jobs(workspaceId).find((j) => j.id === jobId);
		if (!job) throw new Error("Unknown review job");
		if (!isReviewAgentJobActive(job)) return job;
		// Fence synchronously, before waiting for process cleanup.
		this.deps.storage.updateJob(job, { state: "cancelled", phase: "cancelled" }, "Stopped by you");
		const run = job.runId ? this.deps.storage.getRun(job.runId) : undefined;
		if (run?.state === "running") await this.cancel(run);
		const cancelled = this.jobs(workspaceId).find((j) => j.id === jobId);
		if (!cancelled) throw new Error("Review workspace no longer exists");
		return cancelled;
	}
	async get(identity: ReviewPathIdentity) {
		this.deps.validateWorkspace(identity);
		// Polling an unchanged revision is a local durable read. A different observed
		// revision is checked against the provider so an old renderer cannot roll back
		// the authoritative head or invalidate a newer run.
		const stored = this.deps.storage.peek(identity);
		if (stored.identity.headSha === identity.headSha) return stored;
		const generation = this.deps.storage.reserveMetadata(identity);
		const resolved = await this.deps.resolve(identity);
		this.deps.validateWorkspace(identity);
		this.deps.storage.acceptMetadata(identity, resolved.identity, generation);
		return this.deps.storage.peek(identity);
	}
	async start(input: {
		identity: ReviewPathIdentity;
		agent: ReviewPath["agent"];
		alsoReview: boolean;
		auto?: boolean;
	}) {
		this.deps.validateWorkspace(input.identity);
		const runtime = this.deps.runtime();
		const generation = this.deps.storage.reserveMetadata(input.identity);
		const resolved = await this.deps.resolve(input.identity);
		this.deps.validateWorkspace(input.identity);
		if (!this.deps.storage.acceptMetadata(input.identity, resolved.identity, generation))
			throw new Error("Review path request superseded; refresh before mapping");
		if (resolved.identity.headSha !== input.identity.headSha) {
			throw new Error("PR head changed; refresh before mapping");
		}
		const before = this.deps.storage.get(resolved.identity);
		const run = this.deps.storage.begin(resolved.identity, input.agent, resolved.changedFiles, {
			auto: input.auto,
			alsoReview: input.alsoReview,
		});
		if (before.runs.some((r) => r.id === run.id))
			return { run, snapshot: this.deps.storage.peek(resolved.identity) };
		for (const old of before.runs.filter((r) => r.state === "running")) {
			try {
				if (old.kind === "mapping") await runtime.stopMapping({ run: old });
				else await runtime.cancelQuestion({ run: old });
			} catch {
				/* Already fenced; stale terminal cleanup cannot authorize output. */
			}
		}
		try {
			const launch = await runtime.startMapping({
				run,
				agent: input.agent,
				alsoReview: input.alsoReview,
			});
			if (launch?.terminalId && this.deps.storage.getRun(run.id)?.state === "running")
				this.deps.storage.attachTerminal(run, launch.terminalId);
			return {
				run: this.deps.storage.getRun(run.id) ?? run,
				launch,
				snapshot: this.deps.storage.peek(resolved.identity),
			};
		} catch (error) {
			if (this.deps.storage.getRun(run.id)?.state === "running")
				this.deps.storage.fail(run, error instanceof Error ? error.message : "Launch failed");
			throw error;
		}
	}
	async cancel(scope: ReviewPathRunScope) {
		this.deps.validateWorkspace(scope.identity);
		const run = this.deps.storage.getRun(scope.id);
		if (!run) throw new Error("Unknown run");
		this.deps.storage.cancel(scope);
		if (run.kind === "mapping") await this.deps.runtime().stopMapping({ run });
		else await this.deps.runtime().cancelQuestion({ run });
		return this.deps.storage.peek(scope.identity);
	}
	async ask(identity: ReviewPathIdentity, input: unknown) {
		this.deps.validateWorkspace(identity);
		const runtime = this.deps.runtime();
		const data = questionInputSchema.parse(input);
		const generation = this.deps.storage.reserveMetadata(identity);
		const resolved = await this.deps.resolve(identity);
		this.deps.validateWorkspace(identity);
		if (!this.deps.storage.acceptMetadata(identity, resolved.identity, generation))
			throw new Error("Review path request superseded; refresh before asking");
		if (resolved.identity.headSha !== identity.headSha) {
			throw new Error("PR head changed; refresh before asking");
		}
		const before = this.deps.storage.get(identity);
		const { run, question } = this.deps.storage.enqueueQuestion(identity, data);
		if (before.questions.some((q) => q.id === question.id))
			return { run, question, snapshot: this.deps.storage.peek(identity) };
		try {
			const launch = await runtime.ask({ run, question });
			if (launch?.terminalId && this.deps.storage.getRun(run.id)?.state === "running")
				this.deps.storage.attachTerminal(run, launch.terminalId);
			return {
				run: this.deps.storage.getRun(run.id) ?? run,
				question,
				launch,
				snapshot: this.deps.storage.peek(identity),
			};
		} catch (error) {
			if (this.deps.storage.getRun(run.id)?.state === "running")
				this.deps.storage.fail(
					run,
					error instanceof Error ? error.message : "Question launch failed"
				);
			throw error;
		}
	}
}
