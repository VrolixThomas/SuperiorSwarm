import type { ReviewPathIdentity } from "./review-path-runtime";
import type { AskMessage, ReviewPath } from "./review-path-types";

/** A durable user intent. Attempts have fresh run authority; the tab keeps this ID. */
export type ReviewAgentJobState =
	| "queued"
	| "preparing"
	| "running"
	| "needs-input"
	| "completed"
	| "failed"
	| "cancelled"
	| "superseded";
export type ReviewAgentJobPhase =
	| "queued"
	| "metadata"
	| "fetching"
	| "worktree"
	| "launching"
	| "mapping"
	| "answering"
	| "completed"
	| "failed"
	| "cancelled"
	| "superseded";
export interface ReviewAgentJob {
	id: string;
	identity: ReviewPathIdentity;
	agent: ReviewPath["agent"];
	kind: "mapping" | "question";
	alsoReview?: boolean;
	state: ReviewAgentJobState;
	phase: ReviewAgentJobPhase;
	/** Null for legacy runs whose timestamps were never recorded. */
	startedAt: string | null;
	updatedAt: string | null;
	endedAt?: string | null;
	attempt: number;
	runId?: string;
	runVersion?: number;
	terminalId?: string;
	cwd?: string;
	error?: string;
	progress?: { placed: number; total: number; currentFile?: string };
	trigger: "manual" | "auto";
	activity: Array<{ at: string; phase: ReviewAgentJobPhase; message: string }>;
	question?: { id: string; text: string; anchor?: AskMessage["anchor"] };
}
export interface StartReviewAgentJobInput {
	identity: ReviewPathIdentity;
	agent: ReviewPath["agent"];
	alsoReview: boolean;
	requestId: string;
	retryJobId?: string;
	trigger?: "manual" | "auto";
}
export const isReviewAgentJobActive = (job: Pick<ReviewAgentJob, "state">) =>
	["queued", "preparing", "running", "needs-input"].includes(job.state);

export function reviewAgentQuestionId(
	job: Pick<ReviewAgentJob, "id" | "attempt" | "question">
): string {
	return job.attempt === 1 ? (job.question?.id ?? job.id) : `${job.id}:${job.attempt}`;
}
