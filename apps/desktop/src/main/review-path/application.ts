import type {
	ReviewPathIdentity,
	ReviewPathRunScope,
	ReviewPathRuntimePort,
} from "../../shared/review-path-runtime";
import type { ReviewPath } from "../../shared/review-path-types";
import type { ReviewPathStorage } from "./storage";
import { questionInputSchema } from "./validation";

export interface ReviewPathApplicationDeps {
	storage: ReviewPathStorage;
	runtime: () => ReviewPathRuntimePort;
	/** Main-process provider read and registered workspace check, never fixture data. */
	resolve: (
		identity: ReviewPathIdentity
	) => Promise<{ identity: ReviewPathIdentity; changedFiles: string[] }>;
	validateWorkspace: (identity: ReviewPathIdentity) => void;
}
export class ReviewPathApplication {
	constructor(readonly deps: ReviewPathApplicationDeps) {}
	async get(identity: ReviewPathIdentity) {
		this.deps.validateWorkspace(identity);
		// Polling an unchanged revision is a local durable read. A different observed
		// revision is checked against the provider so an old renderer cannot roll back
		// the authoritative head or invalidate a newer run.
		const stored = this.deps.storage.peek(identity);
		if (stored.identity.headSha === identity.headSha) return this.deps.storage.get(identity);
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
