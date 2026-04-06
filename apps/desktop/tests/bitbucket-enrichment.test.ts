import { describe, expect, test } from "bun:test";
import {
	aggregateCIState,
	deriveReviewDecision,
	mapParticipantToReviewer,
} from "../src/main/providers/bitbucket-adapter";

describe("Bitbucket enrichment mapping", () => {
	describe("mapParticipantToReviewer", () => {
		test("maps approved reviewer", () => {
			const participant = {
				user: { display_name: "Alice" },
				role: "REVIEWER",
				state: "approved",
			};
			const result = mapParticipantToReviewer(participant);
			expect(result).toEqual({
				login: "Alice",
				avatarUrl: "",
				decision: "APPROVED",
			});
		});

		test("maps changes_requested reviewer", () => {
			const participant = {
				user: { display_name: "Bob" },
				role: "REVIEWER",
				state: "changes_requested",
			};
			const result = mapParticipantToReviewer(participant);
			expect(result.decision).toBe("CHANGES_REQUESTED");
		});

		test("maps pending reviewer (no state)", () => {
			const participant = {
				user: { display_name: "Carol" },
				role: "REVIEWER",
				state: null,
			};
			const result = mapParticipantToReviewer(participant);
			expect(result.decision).toBe("PENDING");
		});

		test("handles null user", () => {
			const participant = {
				user: null,
				role: "REVIEWER",
				state: "approved",
			};
			const result = mapParticipantToReviewer(participant);
			expect(result.login).toBe("Unknown");
		});
	});

	describe("aggregateCIState", () => {
		test("returns SUCCESS when all successful", () => {
			const statuses = [{ state: "SUCCESSFUL" }, { state: "SUCCESSFUL" }];
			expect(aggregateCIState(statuses)).toBe("SUCCESS");
		});

		test("returns FAILURE when any failed", () => {
			const statuses = [{ state: "SUCCESSFUL" }, { state: "FAILED" }];
			expect(aggregateCIState(statuses)).toBe("FAILURE");
		});

		test("returns PENDING when any in progress", () => {
			const statuses = [{ state: "SUCCESSFUL" }, { state: "INPROGRESS" }];
			expect(aggregateCIState(statuses)).toBe("PENDING");
		});

		test("returns null for empty statuses", () => {
			expect(aggregateCIState([])).toBeNull();
		});

		test("FAILURE takes precedence over INPROGRESS", () => {
			const statuses = [{ state: "FAILED" }, { state: "INPROGRESS" }];
			expect(aggregateCIState(statuses)).toBe("FAILURE");
		});
	});

	describe("deriveReviewDecision", () => {
		test("returns APPROVED when any approved and none requesting changes", () => {
			const reviewers = [
				{ login: "A", avatarUrl: "", decision: "APPROVED" as const },
				{ login: "B", avatarUrl: "", decision: "PENDING" as const },
			];
			expect(deriveReviewDecision(reviewers)).toBe("APPROVED");
		});

		test("returns CHANGES_REQUESTED when any requesting changes", () => {
			const reviewers = [
				{ login: "A", avatarUrl: "", decision: "APPROVED" as const },
				{ login: "B", avatarUrl: "", decision: "CHANGES_REQUESTED" as const },
			];
			expect(deriveReviewDecision(reviewers)).toBe("CHANGES_REQUESTED");
		});

		test("returns REVIEW_REQUIRED when all pending", () => {
			const reviewers = [{ login: "A", avatarUrl: "", decision: "PENDING" as const }];
			expect(deriveReviewDecision(reviewers)).toBe("REVIEW_REQUIRED");
		});

		test("returns REVIEW_REQUIRED for empty reviewers", () => {
			expect(deriveReviewDecision([])).toBe("REVIEW_REQUIRED");
		});
	});
});
