import { z } from "zod";
import type { ReviewPathIdentity, ReviewPathLaunchResult } from "./review-path-runtime";
import type { ReviewPathStatus } from "./review-path-types";

export const reviewPathStatusScopeSchema = z
	.object({
		provider: z.enum(["github", "bitbucket"]),
		owner: z.string().min(1).max(256),
		repo: z.string().min(1).max(256),
		prNumber: z.number().int().positive(),
		headSha: z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/),
		workspaceId: z.string().min(1).max(256).optional(),
		projectId: z.string().min(1).max(256).optional(),
	})
	.strict();
export type ReviewPathStatusScope = z.infer<typeof reviewPathStatusScopeSchema>;
export interface ReviewPathStatusProjection {
	identity: ReviewPathIdentity;
	status: ReviewPathStatus;
	reviewDraftId?: string;
	terminal?: ReviewPathLaunchResult;
}
