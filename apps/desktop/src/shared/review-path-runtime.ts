import { z } from "zod";
import type { AskMessage, ReviewPath, ReviewPathSettings } from "./review-path-types";

export const reviewPathIdentitySchema = z
	.object({
		workspaceId: z.string().min(1).max(256),
		provider: z.enum(["github", "bitbucket"]),
		owner: z.string().min(1).max(256),
		repo: z.string().min(1).max(256),
		prNumber: z.number().int().positive(),
		headSha: z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/),
	})
	.strict();
export type ReviewPathIdentity = z.infer<typeof reviewPathIdentitySchema>;
export const reviewPathRunScopeSchema = z
	.object({
		identity: reviewPathIdentitySchema,
		id: z.string().min(1),
		version: z.number().int().positive(),
	})
	.strict();
export type ReviewPathRunScope = z.infer<typeof reviewPathRunScopeSchema>;
export type ReviewPathRunState = "running" | "completed" | "cancelled" | "failed" | "superseded";
export interface ReviewPathRun extends ReviewPathRunScope {
	kind: "mapping" | "question";
	state: ReviewPathRunState;
	conversationId: string;
	questionId?: string;
	reviewDraftId?: string;
	terminalId?: string;
	error?: string;
}
export interface ReviewPathQuestion {
	id: string;
	conversationId: string;
	runId: string;
	state: "pending" | "answered" | "cancelled" | "failed" | "superseded";
	message: AskMessage;
	answer?: AskMessage;
	error?: string;
}
export interface ReviewPathSnapshot {
	identity: ReviewPathIdentity;
	path: ReviewPath | null;
	pathVersion: number;
	conversationId: string;
	runs: ReviewPathRun[];
	questions: ReviewPathQuestion[];
	messages: AskMessage[];
}
export interface ReviewPathLaunchResult {
	terminalId?: string;
	reviewWorkspaceId?: string;
	worktreePath?: string;
	launchScript?: string;
	cliPreset?: string;
}
/** Runtime owns launches. Persistence creates/fences every run before calling this port. */
export interface ReviewPathRuntimePort {
	startMapping(input: {
		run: ReviewPathRun;
		agent: ReviewPath["agent"];
		alsoReview: boolean;
	}): Promise<ReviewPathLaunchResult | undefined>;
	stopMapping(input: { run: ReviewPathRun }): Promise<void>;
	ask(input: {
		run: ReviewPathRun;
		question: ReviewPathQuestion;
	}): Promise<ReviewPathLaunchResult | undefined>;
	cancelQuestion(input: { run: ReviewPathRun }): Promise<void>;
}
export const reviewPathSettingsSchema = z
	.object({
		autoMapOnReviewRequest: z.boolean(),
		alsoReview: z.boolean(),
		defaultRailMode: z.enum(["path", "files", "auto"]),
	})
	.strict();
export const defaultReviewPathSettings: ReviewPathSettings = {
	autoMapOnReviewRequest: false,
	alsoReview: true,
	defaultRailMode: "auto",
};
