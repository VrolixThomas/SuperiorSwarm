import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
	type ReviewAgentJob,
	type ReviewAgentJobPhase,
	type StartReviewAgentJobInput,
	isReviewAgentJobActive,
} from "../../shared/review-agent-job";
import {
	type ReviewPathIdentity,
	type ReviewPathQuestion,
	type ReviewPathRun,
	type ReviewPathRunScope,
	type ReviewPathSnapshot,
	defaultReviewPathSettings,
	reviewPathIdentitySchema,
	reviewPathRunScopeSchema,
	reviewPathSettingsSchema,
} from "../../shared/review-path-runtime";
import type {
	ContextFileStep,
	ReviewPath,
	ReviewPathEntry,
	ReviewPathSettings,
} from "../../shared/review-path-types";
import type { getDb } from "../db";
import { reviewPathDocuments, reviewPathPreferences, workspaces } from "../db/schema";
import { draftComments, reviewDrafts } from "../db/schema-ai-review";
import {
	answerInputSchema,
	contextStepSchema,
	findingInputSchema,
	pathContentSchema,
	questionInputSchema,
	repoPathSchema,
	stepSchema,
	threadNoteSchema,
	validateCoverage,
} from "./validation";

type Db = ReturnType<typeof getDb>;
interface Document extends ReviewPathSnapshot {
	jobData?: {
		version: 1;
		jobs: ReviewAgentJob[];
		runIds?: string[];
		requests: Record<string, { jobId: string; fingerprint: string }>;
	};
	/** Durable provider-observation fence, defaulting to zero for older documents. */
	metadataGeneration?: number;
	/** Latest outstanding observation, independent of intervening run mutations. */
	metadataPendingGeneration?: number;
	/** High-water mark: a later reservation cannot erase an accepted conflicting head. */
	metadataAcceptedGeneration?: number;
	metadataRequestedHead?: string;
	changedFiles: string[];
	nextVersion: number;
	autoClaims: Record<string, string>;
	capabilities: Record<string, string>;
}
export function reviewPathKey(i: ReviewPathIdentity) {
	return JSON.stringify([i.workspaceId, i.provider, i.owner, i.repo, i.prNumber]);
}
const now = () => new Date().toISOString();
const hash = (s: string) => createHash("sha256").update(s).digest("hex");

export class ReviewPathStorage {
	constructor(private readonly db: Db) {}
	private load(identity: ReviewPathIdentity, projectionOnly = false): Document {
		reviewPathIdentitySchema.parse(identity);
		const row = this.db
			.select()
			.from(reviewPathDocuments)
			.where(eq(reviewPathDocuments.key, reviewPathKey(identity)))
			.get();
		return row
			? JSON.parse(row.payload)
			: {
					identity,
					path: null,
					pathVersion: 0,
					// Empty read-only projections stay equal across polls. Durable creation
					// still receives a fresh conversation, including Ask before any mapping.
					conversationId: projectionOnly
						? `uninitialized:${reviewPathKey(identity)}`
						: randomUUID(),
					runs: [],
					questions: [],
					messages: [],
					changedFiles: [],
					nextVersion: 0,
					autoClaims: {},
					capabilities: {},
				};
	}
	private save(doc: Document) {
		// Run mutations (including capability-only completion) update the same durable job.
		const currentMapping = doc.runs.filter((run) => run.kind === "mapping").at(-1);
		for (const job of doc.jobData?.jobs ?? []) {
			const run = doc.runs.find((r) => r.id === job.runId && r.version === job.runVersion);
			if (!run || !isReviewAgentJobActive(job)) continue;
			if (run.terminalId) job.terminalId = run.terminalId;
			if (
				job.kind === "mapping" &&
				currentMapping?.id === run.id &&
				doc.path?.headSha === job.identity.headSha
			) {
				if (JSON.stringify(job.progress) !== JSON.stringify(doc.path.progress)) {
					job.progress = doc.path.progress;
					job.updatedAt = now();
					if (job.progress?.placed)
						job.activity.push({
							at: job.updatedAt,
							phase: "mapping",
							message: `${job.progress.placed} of ${job.progress.total} files placed`,
						});
				}
			}
			if (run.state !== "running") {
				job.state = run.state;
				job.phase = run.state;
				job.error = run.error;
				job.updatedAt = job.endedAt = now();
				job.activity.push({
					at: job.updatedAt,
					phase: job.phase,
					message: run.error ?? `Agent ${run.state}`,
				});
			}
		}
		this.db
			.insert(reviewPathDocuments)
			.values({
				key: reviewPathKey(doc.identity),
				workspaceId: doc.identity.workspaceId,
				payload: JSON.stringify(doc),
			})
			.onConflictDoUpdate({
				target: reviewPathDocuments.key,
				set: { payload: JSON.stringify(doc) },
			})
			.run();
	}
	private transaction<T>(identity: ReviewPathIdentity, action: (doc: Document) => T): T {
		return this.db.transaction(() => {
			const doc = this.load(identity);
			const result = action(doc);
			this.save(doc);
			return result;
		});
	}
	/** Read-only projection; old runs explicitly retain unknown timing. */
	jobs(workspaceId: string): ReviewAgentJob[] {
		return this.documents(workspaceId)
			.flatMap((doc) => {
				const jobs = doc.jobData?.jobs ?? [];
				const currentMapping = doc.runs.filter((run) => run.kind === "mapping").at(-1);
				return [
					...jobs,
					...doc.runs
						.filter(
							(r) => !jobs.some((j) => j.runId === r.id) && !doc.jobData?.runIds?.includes(r.id)
						)
						.map(
							(run) =>
								({
									id: `legacy:${run.id}`,
									identity: run.identity,
									agent: doc.path?.agent ?? { id: "unknown", label: "Agent" },
									kind: run.kind,
									progress:
										currentMapping?.id === run.id && doc.path?.headSha === run.identity.headSha
											? doc.path.progress
											: undefined,
									alsoReview: run.alsoReview,
									question: run.questionId ? this.legacyQuestion(doc, run.questionId) : undefined,
									state: run.state,
									phase:
										run.state === "running"
											? run.kind === "mapping"
												? "mapping"
												: "answering"
											: run.state,
									startedAt: null,
									updatedAt: null,
									endedAt: run.state === "running" ? undefined : null,
									attempt: 1,
									runId: run.id,
									runVersion: run.version,
									terminalId: run.terminalId,
									error: run.error,
									trigger: "manual",
									activity: [],
								}) satisfies ReviewAgentJob
						),
				];
			})
			.sort(
				(a, b) =>
					(a.startedAt ? Date.parse(a.startedAt) : 0) - (b.startedAt ? Date.parse(b.startedAt) : 0)
			);
	}
	private legacyQuestion(doc: Document, id: string): ReviewAgentJob["question"] {
		const question = doc.questions.find((q) => q.id === id);
		return question
			? { id, text: question.message.text, anchor: question.message.anchor }
			: undefined;
	}
	acceptJob(input: StartReviewAgentJobInput, question?: ReviewAgentJob["question"]) {
		return this.transaction(input.identity, (doc) => {
			doc.jobData ??= { version: 1, jobs: [], requests: {} };
			const data = doc.jobData;
			const requestKey = hash(input.requestId);
			const fingerprint = JSON.stringify({
				identity: input.identity,
				agent: input.agent,
				alsoReview: input.alsoReview,
				retryJobId: input.retryJobId,
				trigger: input.trigger ?? "manual",
				question,
			});
			const prior = data.requests[requestKey];
			if (prior) {
				if (prior.fingerprint !== fingerprint)
					throw new Error("Job request ID reused with a different intent");
				const job = data.jobs.find((j) => j.id === prior.jobId);
				if (!job) throw new Error("Saved review job is unavailable");
				return { job, accepted: false };
			}
			const kind = question ? "question" : "mapping";
			let retry = input.retryJobId ? data.jobs.find((j) => j.id === input.retryJobId) : undefined;
			if (!retry && input.retryJobId?.startsWith("legacy:")) {
				const legacy = this.jobs(input.identity.workspaceId).find((j) => j.id === input.retryJobId);
				if (legacy && reviewPathKey(legacy.identity) === reviewPathKey(input.identity)) {
					retry = legacy;
					data.jobs.push(legacy);
					if (legacy.runId) {
						data.runIds ??= [];
						data.runIds.push(legacy.runId);
					}
				}
			}
			if (
				input.retryJobId &&
				(!retry || retry.kind !== kind || retry.identity.headSha !== input.identity.headSha)
			)
				throw new Error("Retry job scope mismatch");
			if (retry && !["failed", "cancelled"].includes(retry.state))
				throw new Error("Only failed or cancelled jobs can be retried");
			if (input.trigger === "auto") {
				const existing = data.jobs
					.filter((j) => j.kind === kind && j.identity.headSha === input.identity.headSha)
					.at(-1);
				if (existing) {
					data.requests[requestKey] = { jobId: existing.id, fingerprint };
					return { job: existing, accepted: false };
				}
			}
			// Acceptance is only an intent. A stale renderer must not revoke a
			// verified run before provider metadata authorizes the replacement.
			if (kind === "mapping")
				for (const old of data.jobs) {
					if (
						old.kind !== "mapping" ||
						old.runId ||
						old.identity.headSha !== input.identity.headSha ||
						!isReviewAgentJobActive(old)
					)
						continue;
					old.state = old.phase = "superseded";
					old.endedAt = old.updatedAt = now();
				}
			const at = now();
			const job: ReviewAgentJob = {
				id: retry?.id ?? randomUUID(),
				identity: input.identity,
				agent: input.agent,
				kind,
				alsoReview: retry?.alsoReview ?? input.alsoReview,
				state: "queued",
				phase: "queued",
				startedAt: at,
				updatedAt: at,
				attempt: (retry?.attempt ?? 0) + 1,
				trigger: input.trigger ?? "manual",
				question,
				activity: [{ at, phase: "queued", message: "Request accepted" }],
			};
			if (retry) data.jobs[data.jobs.indexOf(retry)] = job;
			else data.jobs.push(job);
			data.requests[requestKey] = { jobId: job.id, fingerprint };
			return { job, accepted: true };
		});
	}
	updateJob(
		job: ReviewAgentJob,
		patch: Partial<
			Pick<
				ReviewAgentJob,
				"state" | "phase" | "runId" | "runVersion" | "terminalId" | "cwd" | "error"
			>
		>,
		message?: string
	): ReviewAgentJob | undefined {
		return this.transaction(job.identity, (doc) => {
			const data = doc.jobData;
			const current = data?.jobs.find((j) => j.id === job.id && j.attempt === job.attempt);
			if (!data || !current || !isReviewAgentJobActive(current)) return;
			if (patch.runId) {
				data.runIds ??= [];
				data.runIds.push(patch.runId);
			}
			const at = now();
			Object.assign(current, patch, { updatedAt: at });
			if (!isReviewAgentJobActive(current)) current.endedAt = current.updatedAt;
			if (message) current.activity.push({ at, phase: current.phase, message });
			return current;
		});
	}
	reportRunPhase(run: ReviewPathRun, phase: ReviewAgentJobPhase, message: string) {
		const job = this.jobs(run.identity.workspaceId).find(
			(j) => j.runId === run.id && j.runVersion === run.version
		);
		if (job) this.updateJob(job, { phase }, message);
	}
	interruptPreparingJobs() {
		for (const doc of this.documents())
			for (const job of doc.jobData?.jobs ?? [])
				if (isReviewAgentJobActive(job))
					this.updateJob(
						job,
						{
							state: "failed",
							phase: "failed",
							error: "Agent interrupted by application restart. Retry to start a new attempt.",
						},
						"Application restarted"
					);
	}
	private snapshot(doc: Document): ReviewPathSnapshot {
		return {
			identity: doc.identity,
			path: doc.path,
			pathVersion: doc.pathVersion,
			conversationId: doc.conversationId,
			runs: doc.runs,
			questions: doc.questions,
			messages: doc.messages,
		};
	}
	peek(identity: ReviewPathIdentity): ReviewPathSnapshot {
		return this.snapshot(this.load(identity, true));
	}
	/** Reserve before awaiting provider metadata, across all application/storage instances. */
	reserveMetadata(identity: ReviewPathIdentity): number {
		return this.transaction(identity, (doc) => {
			const generation = this.advanceMetadata(doc);
			doc.metadataPendingGeneration = generation;
			doc.metadataRequestedHead = identity.headSha;
			return generation;
		});
	}
	private advanceMetadata(doc: Document) {
		doc.metadataGeneration = (doc.metadataGeneration ?? 0) + 1;
		return doc.metadataGeneration;
	}
	/** Compare and apply in one SQLite transaction; rejected observations cannot revoke runs. */
	acceptMetadata(
		requested: ReviewPathIdentity,
		resolved: ReviewPathIdentity,
		generation: number
	): boolean {
		reviewPathIdentitySchema.parse(resolved);
		if (reviewPathKey(requested) !== reviewPathKey(resolved))
			throw new Error("Resolved review path scope mismatch");
		return this.transaction(requested, (doc) => {
			if (doc.metadataPendingGeneration !== generation) return false;
			doc.metadataPendingGeneration = undefined;
			doc.metadataAcceptedGeneration = Math.max(doc.metadataAcceptedGeneration ?? 0, generation);
			this.head(doc, resolved);
			this.advanceMetadata(doc);
			return true;
		});
	}
	/** A read and job checking the same requested head may share its observation.
	 * Never let a delayed result replace a different head that was already accepted.
	 */
	acceptJobMetadata(
		requested: ReviewPathIdentity,
		resolved: ReviewPathIdentity,
		generation: number
	): boolean {
		reviewPathIdentitySchema.parse(resolved);
		if (reviewPathKey(requested) !== reviewPathKey(resolved))
			throw new Error("Resolved review path scope mismatch");
		return this.transaction(requested, (doc) => {
			if (doc.metadataPendingGeneration === generation) {
				doc.metadataPendingGeneration = undefined;
				doc.metadataAcceptedGeneration = Math.max(doc.metadataAcceptedGeneration ?? 0, generation);
				this.head(doc, resolved);
				this.advanceMetadata(doc);
				return true;
			}
			if (
				resolved.headSha !== requested.headSha ||
				doc.metadataRequestedHead !== requested.headSha ||
				((doc.metadataAcceptedGeneration ?? 0) > generation &&
					doc.identity.headSha !== requested.headSha) ||
				(doc.metadataPendingGeneration === undefined && doc.identity.headSha !== requested.headSha)
			)
				return false;
			// Keep the newer read's reservation valid. If it observes a later head,
			// it must still be able to fence this exact-revision run after launch.
			this.head(doc, resolved);
			return true;
		});
	}
	private preserveUserContext(
		previous: ReviewPath | null,
		entries: ReviewPathEntry[],
		changedFiles: string[]
	) {
		const preserveEntry = (id: string) => {
			const old = previous?.entries.find((e) => e.id === id);
			if (!old) throw new Error("Unknown user context entry");
			let entry = entries.find((e) => e.id === id);
			if (entry && entry.title !== old.title)
				throw new Error("Agent cannot overwrite user context entry");
			if (!entry) {
				entry = { id, title: old.title, steps: [] };
				entries.push(entry);
			}
			return entry;
		};
		for (const oldEntry of previous?.entries ?? [])
			for (const step of oldEntry.steps) {
				if (step.kind !== "context" || step.addedBy !== "user") continue;
				if (changedFiles.includes(step.path))
					throw new Error("User context is now changed; remove it before remapping");
				for (const entry of entries)
					for (const candidate of entry.steps) {
						if (candidate.id === step.id || candidate.path === step.path) {
							if (entry.id !== oldEntry.id || JSON.stringify(candidate) !== JSON.stringify(step))
								throw new Error("Agent cannot overwrite or move user context");
						}
						if (candidate.kind === "changed" && candidate.tests.some((t) => t.path === step.path))
							throw new Error("Agent cannot replace user context with a test");
					}
				const entry = preserveEntry(oldEntry.id);
				for (const id of step.alsoIn ?? []) preserveEntry(id);
				if (!entry.steps.some((s) => s.id === step.id)) {
					// Retain the user's position within its entry when an agent omits it.
					entry.steps.splice(Math.min(oldEntry.steps.indexOf(step), entry.steps.length), 0, step);
				}
			}
	}
	private invalidate(doc: Document) {
		for (const run of doc.runs)
			if (run.state === "running") {
				run.state = "superseded";
				this.endDraft(run, "cancelled");
			}
		for (const q of doc.questions) if (q.state === "pending") q.state = "superseded";
		doc.capabilities = {};
	}
	private head(doc: Document, identity: ReviewPathIdentity) {
		if (doc.identity.headSha !== identity.headSha) {
			if (doc.metadataRequestedHead !== identity.headSha) doc.metadataPendingGeneration = undefined;
			doc.metadataAcceptedGeneration = this.advanceMetadata(doc);
			this.invalidate(doc);
			doc.identity = identity;
			if (doc.path) {
				doc.path.status = "stale";
				doc.path.updatedAt = now();
				doc.pathVersion++;
			}
		}
	}
	get(identity: ReviewPathIdentity): ReviewPathSnapshot {
		return this.transaction(identity, (doc) => {
			this.head(doc, identity);
			return this.snapshot(doc);
		});
	}
	getRun(id: string): ReviewPathRun | undefined {
		return this.documents()
			.flatMap((d) => d.runs)
			.find((r) => r.id === id);
	}
	getActiveRuns(): ReviewPathRun[] {
		return this.documents()
			.flatMap((d) => d.runs)
			.filter((r) => r.state === "running");
	}
	private documents(workspaceId?: string): Document[] {
		return this.db
			.select()
			.from(reviewPathDocuments)
			.where(workspaceId ? eq(reviewPathDocuments.workspaceId, workspaceId) : undefined)
			.all()
			.map((r) => JSON.parse(r.payload));
	}
	private active(
		doc: Document,
		scope: ReviewPathRunScope,
		kind?: ReviewPathRun["kind"]
	): ReviewPathRun {
		reviewPathRunScopeSchema.parse({
			identity: scope.identity,
			id: scope.id,
			version: scope.version,
		});
		const run = doc.runs.find((r) => r.id === scope.id && r.version === scope.version);
		if (
			!run ||
			run.state !== "running" ||
			reviewPathKey(run.identity) !== reviewPathKey(scope.identity) ||
			run.identity.headSha !== scope.identity.headSha ||
			doc.identity.headSha !== scope.identity.headSha ||
			(kind && run.kind !== kind)
		)
			throw new Error("Inactive or mismatched review path run");
		return run;
	}
	begin(
		identity: ReviewPathIdentity,
		agent: ReviewPath["agent"],
		changedFiles: string[],
		options: { auto?: boolean; alsoReview?: boolean } = {}
	): ReviewPathRun {
		for (const p of changedFiles) repoPathSchema.parse(p);
		if (new Set(changedFiles).size !== changedFiles.length)
			throw new Error("Duplicate changed files");
		return this.transaction(identity, (doc) => {
			this.head(doc, identity);
			const claimed = options.auto && doc.autoClaims[identity.headSha];
			const previous = claimed && doc.runs.find((r) => r.id === claimed);
			if (previous) return previous;
			this.advanceMetadata(doc);
			this.invalidate(doc);
			doc.changedFiles = changedFiles;
			doc.conversationId = randomUUID();
			const previousPath = doc.path;
			const run: ReviewPathRun = {
				identity,
				id: randomUUID(),
				version: ++doc.nextVersion,
				kind: "mapping",
				alsoReview: options.alsoReview,
				state: "running",
				conversationId: doc.conversationId,
			};
			doc.runs.push(run);
			doc.path = {
				id: randomUUID(),
				prKey: `${identity.owner}/${identity.repo}#${identity.prNumber}`,
				headSha: identity.headSha,
				agent,
				status: "mapping",
				entries: [],
				otherFiles: changedFiles,
				progress: { placed: 0, total: changedFiles.length },
				updatedAt: now(),
			};
			doc.pathVersion++;
			this.preserveUserContext(previousPath, doc.path.entries, changedFiles);
			if (options.auto) doc.autoClaims[identity.headSha] = run.id;
			return run;
		});
	}
	setPath(scope: ReviewPathRunScope, input: unknown) {
		const content = pathContentSchema.parse(input);
		return this.transaction(scope.identity, (doc) => {
			this.active(doc, scope, "mapping");
			const path = doc.path;
			if (!path) throw new Error("Missing path");
			for (const step of content.entries.flatMap((e) => e.steps)) {
				const old = path.entries.flatMap((e) => e.steps).find((s) => s.id === step.id);
				if (
					(step.kind === "context" && step.addedBy === "user") ||
					(old?.kind === "context" && old.addedBy === "user")
				) {
					if (!old || JSON.stringify(old) !== JSON.stringify(step))
						throw new Error("Agent cannot impersonate or overwrite user context");
				}
			}
			this.preserveUserContext(path, content.entries, doc.changedFiles);
			validateCoverage(content.entries, content.otherFiles, doc.changedFiles);
			const before = JSON.stringify({
				entries: path.entries,
				otherFiles: path.otherFiles,
				reviewed: path.reviewed,
			});
			if (
				before ===
				JSON.stringify({
					entries: content.entries,
					otherFiles: content.otherFiles,
					reviewed: content.reviewed,
				})
			)
				return;
			Object.assign(path, content, {
				updatedAt: now(),
				progress: {
					placed: doc.changedFiles.length - content.otherFiles.length,
					total: doc.changedFiles.length,
				},
			});
			doc.pathVersion++;
		});
	}
	addStep(scope: ReviewPathRunScope, entryId: string, title: string, input: unknown) {
		const step = stepSchema.parse(input);
		if (step.kind === "context" && step.addedBy !== "agent")
			throw new Error("Agent cannot impersonate user context");
		return this.transaction(scope.identity, (doc) => {
			this.active(doc, scope, "mapping");
			if (!doc.path) throw new Error("Missing path");
			const entries = doc.path.entries;
			let entry = entries.find((e) => e.id === entryId);
			if (!entry) {
				entry = { id: entryId, title, steps: [] };
				entries.push(entry);
			}
			const existing = entries.flatMap((e) => e.steps).find((s) => s.id === step.id);
			if (existing) {
				if (JSON.stringify(existing) === JSON.stringify(step)) return;
				throw new Error("Duplicate step ID");
			}
			entry.steps.push(step);
			const placed = new Set([
				step.path,
				...(step.kind === "changed" ? step.tests.filter((t) => t.changed).map((t) => t.path) : []),
			]);
			doc.path.otherFiles = doc.path.otherFiles.filter((p) => !placed.has(p));
			pathContentSchema.parse({ entries, otherFiles: doc.path.otherFiles });
			validateCoverage(entries, doc.path.otherFiles, doc.changedFiles);
			doc.path.progress = {
				placed: doc.changedFiles.length - doc.path.otherFiles.length,
				total: doc.changedFiles.length,
			};
			doc.path.updatedAt = now();
			doc.pathVersion++;
		});
	}
	setThreadNote(scope: ReviewPathRunScope, threadId: string, input: unknown) {
		const note = threadNoteSchema.parse(input);
		if (!threadId || threadId.length > 256) throw new Error("Invalid thread ID");
		return this.transaction(scope.identity, (doc) => {
			this.active(doc, scope, "mapping");
			if (!doc.path) throw new Error("Missing path");
			if (JSON.stringify(doc.path.threadNotes?.[threadId]) === JSON.stringify(note)) return;
			doc.path.threadNotes = { ...doc.path.threadNotes, [threadId]: note };
			doc.path.updatedAt = now();
			doc.pathVersion++;
		});
	}
	addUserContext(identity: ReviewPathIdentity, entryId: string, input: ContextFileStep) {
		const step = contextStepSchema.parse(input);
		if (step.addedBy !== "user") throw new Error("Expected user context");
		return this.transaction(identity, (doc) => {
			if (doc.identity.headSha !== identity.headSha || doc.path?.headSha !== identity.headSha)
				throw new Error("Stale path");
			const entry = doc.path.entries.find((e) => e.id === entryId);
			if (!entry) throw new Error("Unknown entry");
			entry.steps.push(step);
			validateCoverage(doc.path.entries, doc.path.otherFiles, doc.changedFiles);
			doc.pathVersion++;
			doc.path.updatedAt = now();
		});
	}
	removeUserContext(identity: ReviewPathIdentity, stepId: string) {
		return this.transaction(identity, (doc) => {
			// A user may discard retained context from a stale path before remapping,
			// including when that file has become changed in the current revision.
			if (doc.identity.headSha !== identity.headSha || !doc.path) throw new Error("Stale path");
			for (const entry of doc.path.entries)
				entry.steps = entry.steps.filter((s) => !(s.id === stepId && s.kind === "context"));
			doc.pathVersion++;
			doc.path.updatedAt = now();
		});
	}
	enqueueQuestion(
		identity: ReviewPathIdentity,
		input: unknown
	): { run: ReviewPathRun; question: ReviewPathQuestion } {
		const data = questionInputSchema.parse(input);
		return this.transaction(identity, (doc) => {
			this.head(doc, identity);
			const existing = doc.questions.find((q) => q.id === data.id);
			if (existing) {
				if (
					existing.message.text !== data.text ||
					JSON.stringify(existing.message.anchor) !== JSON.stringify(data.anchor)
				)
					throw new Error("Question ID reused");
				const run = doc.runs.find((r) => r.id === existing.runId);
				if (!run) throw new Error("Missing question run");
				return { run, question: existing };
			}
			this.advanceMetadata(doc);
			const run: ReviewPathRun = {
				identity,
				id: randomUUID(),
				version: ++doc.nextVersion,
				kind: "question",
				state: "running",
				conversationId: doc.conversationId,
				questionId: data.id,
			};
			const question: ReviewPathQuestion = {
				id: data.id,
				conversationId: doc.conversationId,
				runId: run.id,
				state: "pending",
				message: {
					id: data.id,
					role: "user",
					text: data.text,
					anchor: data.anchor,
					createdAt: now(),
				},
			};
			doc.runs.push(run);
			doc.questions.push(question);
			doc.messages.push(question.message);
			return { run, question };
		});
	}
	answerQuestion(scope: ReviewPathRunScope, questionId: string, input: unknown) {
		const data = answerInputSchema.parse(input);
		return this.transaction(scope.identity, (doc) => {
			const run = this.active(doc, scope, "question");
			const q = doc.questions.find(
				(q) => q.id === questionId && q.runId === run.id && q.conversationId === run.conversationId
			);
			if (!q || q.state !== "pending" || run.questionId !== questionId)
				throw new Error("Wrong or ended question");
			q.answer = {
				id: randomUUID(),
				role: "agent",
				text: data.text,
				refs: data.refs,
				createdAt: now(),
			};
			q.state = "answered";
			run.state = "completed";
			doc.messages.push(q.answer);
			delete doc.capabilities[run.id];
		});
	}
	finish(scope: ReviewPathRunScope) {
		return this.end(scope, "completed");
	}
	fail(scope: ReviewPathRunScope, error: string) {
		return this.end(scope, "failed", error);
	}
	cancel(scope: ReviewPathRunScope) {
		return this.end(scope, "cancelled");
	}
	private end(
		scope: ReviewPathRunScope,
		state: "completed" | "failed" | "cancelled",
		error?: string
	) {
		return this.transaction(scope.identity, (doc) => {
			const run = this.active(doc, scope);
			if (run.kind === "question" && state === "completed")
				throw new Error("Questions complete through answerQuestion");
			run.state = state;
			this.endDraft(run, state === "completed" ? "ready" : state);
			run.error = error;
			delete doc.capabilities[run.id];
			if (run.kind === "mapping" && doc.path) {
				doc.path.status = state === "completed" ? "ready" : "failed";
				doc.path.error = error ?? (state === "cancelled" ? "Mapping cancelled" : undefined);
				doc.path.updatedAt = now();
				doc.pathVersion++;
			}
			const q = doc.questions.find((q) => q.runId === run.id);
			if (q) {
				q.state = state === "cancelled" ? "cancelled" : "failed";
				q.error = error;
			}
		});
	}
	private endDraft(run: ReviewPathRun, status: string) {
		if (run.reviewDraftId)
			this.db
				.update(reviewDrafts)
				.set({ status, updatedAt: new Date() })
				.where(and(eq(reviewDrafts.id, run.reviewDraftId), eq(reviewDrafts.status, "in_progress")))
				.run();
	}
	attachReviewDraft(scope: ReviewPathRunScope, draftId: string) {
		this.transaction(scope.identity, (doc) => {
			const run = this.active(doc, scope, "mapping");
			const draft = this.db.select().from(reviewDrafts).where(eq(reviewDrafts.id, draftId)).get();
			if (
				!draft ||
				draft.prProvider !== run.identity.provider ||
				draft.prIdentifier !==
					`${run.identity.owner}/${run.identity.repo}#${run.identity.prNumber}` ||
				draft.commitSha !== run.identity.headSha ||
				draft.status !== "in_progress"
			)
				throw new Error("Review draft identity mismatch");
			if (
				this.documents().some((d) =>
					d.runs.some((r) => r.reviewDraftId === draftId && r.id !== run.id)
				)
			)
				throw new Error("Review draft already owned");
			if (run.reviewDraftId && run.reviewDraftId !== draftId)
				throw new Error("Review run already owns a draft");
			run.reviewDraftId = draftId;
			this.db
				.update(workspaces)
				.set({ reviewDraftId: draftId, updatedAt: new Date() })
				.where(eq(workspaces.id, run.identity.workspaceId))
				.run();
		});
	}
	private draftFor(doc: Document, scope: ReviewPathRunScope) {
		const run = this.active(doc, scope, "mapping");
		const draft = run.reviewDraftId
			? this.db.select().from(reviewDrafts).where(eq(reviewDrafts.id, run.reviewDraftId)).get()
			: undefined;
		if (!draft || draft.status !== "in_progress") throw new Error("No active local review draft");
		return draft;
	}
	addFinding(scope: ReviewPathRunScope, input: unknown) {
		const data = findingInputSchema.parse(input);
		this.transaction(scope.identity, (doc) => {
			const draft = this.draftFor(doc, scope);
			if (!doc.changedFiles.includes(data.file_path))
				throw new Error("Finding is not on a changed file");
			const body = data.category ? `**${data.category}**\n\n${data.body}` : data.body;
			const id = hash(JSON.stringify([scope.id, data]));
			this.db
				.insert(draftComments)
				.values({
					id,
					reviewDraftId: draft.id,
					filePath: data.file_path,
					lineNumber: data.line_number,
					side: data.side,
					body,
					status: "pending",
					createdAt: new Date(),
				})
				.onConflictDoNothing()
				.run();
			if (doc.path) {
				doc.path.reviewed = {
					findings: this.db
						.select()
						.from(draftComments)
						.where(eq(draftComments.reviewDraftId, draft.id))
						.all().length,
				};
				doc.path.updatedAt = now();
				doc.pathVersion++;
			}
		});
	}
	setReviewSummary(scope: ReviewPathRunScope, summary: string) {
		if (typeof summary !== "string" || summary.length > 64000) throw new Error("Invalid summary");
		this.transaction(scope.identity, (doc) => {
			const draft = this.draftFor(doc, scope);
			this.db
				.update(reviewDrafts)
				.set({ summaryMarkdown: summary, updatedAt: new Date() })
				.where(eq(reviewDrafts.id, draft.id))
				.run();
		});
	}

	attachTerminal(scope: ReviewPathRunScope, terminalId: string) {
		this.transaction(scope.identity, (doc) => {
			this.active(doc, scope).terminalId = terminalId;
		});
	}
	grantCapability(scope: ReviewPathRunScope): string {
		const token = randomUUID() + randomUUID();
		this.transaction(scope.identity, (doc) => {
			this.active(doc, scope);
			doc.capabilities[scope.id] = hash(token);
		});
		return token;
	}
	authenticateCapability(token: string): ReviewPathRun {
		const candidate = hash(token);
		for (const doc of this.documents())
			for (const [runId, digest] of Object.entries(doc.capabilities)) {
				if (timingSafeEqual(Buffer.from(candidate), Buffer.from(digest))) {
					const run = doc.runs.find((r) => r.id === runId);
					if (run) return this.active(doc, run);
				}
			}
		throw new Error("Invalid review path capability");
	}
	getSettings(): ReviewPathSettings {
		const row = this.db
			.select()
			.from(reviewPathPreferences)
			.where(eq(reviewPathPreferences.key, "settings"))
			.get();
		return row
			? reviewPathSettingsSchema.parse(JSON.parse(row.payload))
			: defaultReviewPathSettings;
	}
	updateSettings(input: ReviewPathSettings): ReviewPathSettings {
		const settings = reviewPathSettingsSchema.parse(input);
		this.db
			.insert(reviewPathPreferences)
			.values({ key: "settings", payload: JSON.stringify(settings) })
			.onConflictDoUpdate({
				target: reviewPathPreferences.key,
				set: { payload: JSON.stringify(settings) },
			})
			.run();
		return settings;
	}
	importLegacySettings(input: ReviewPathSettings): ReviewPathSettings {
		return this.db.transaction(() => {
			const exists = this.db
				.select()
				.from(reviewPathPreferences)
				.where(eq(reviewPathPreferences.key, "settings"))
				.get();
			return exists ? this.getSettings() : this.updateSettings(input);
		});
	}
}
