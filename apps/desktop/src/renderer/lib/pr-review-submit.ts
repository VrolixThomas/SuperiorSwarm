export type ReviewVerdict = "COMMENT" | "APPROVE" | "REQUEST_CHANGES";

/** True when submitting would perform at least one API call. */
export function hasSubmitPayload(
	acceptedCount: number,
	verdict: ReviewVerdict,
	body: string
): boolean {
	return acceptedCount > 0 || verdict !== "COMMENT" || body.trim().length > 0;
}

export interface SubmitOutcome {
	posted: number;
	failed: number;
	skipped: number;
	errors: string[];
	verdictSubmitted: boolean;
	skippedVerdict: boolean;
}
