import { describe, expect, test } from "bun:test";
import { bitbucketActivity, githubActivity, prIdentity } from "../src/main/providers/pr-activity";

describe("compact PR observations", () => {
	test("identity includes provider and repository", () => {
		expect(
			new Set([
				prIdentity("github", "o", "a", 1),
				prIdentity("github", "o", "b", 1),
				prIdentity("bitbucket", "o", "a", 1),
			]).size
		).toBe(3);
	});
	test("GitHub requires current requests, never historical reviewer membership", () => {
		expect(
			githubActivity({ reviewRequests: { nodes: [], pageInfo: { hasNextPage: false } } }, "me", [])
				.reviewRequested
		).toBe(false);
		expect(
			githubActivity(
				{
					reviewRequests: {
						nodes: [{ requestedReviewer: { login: "me" } }],
						pageInfo: { hasNextPage: false },
					},
				},
				"me",
				[]
			).reviewRequested
		).toBe(true);
	});
	test("partial GitHub requests and missing identity remain unknown", () => {
		expect(
			githubActivity({ reviewRequests: { nodes: [], pageInfo: { hasNextPage: true } } }, "me", [])
				.reviewRequested
		).toBeUndefined();
		expect(
			githubActivity(
				{ reviewRequests: { nodes: [], pageInfo: { hasNextPage: false } } },
				"me",
				undefined
			).reviewRequested
		).toBeUndefined();
		expect(githubActivity({}, "me", []).isDraft).toBeUndefined();
	});
	test("GitHub recognizes team requests and tracks compact review/comment evidence", () => {
		const result = githubActivity(
			{
				isDraft: false,
				headRefOid: "abc",
				state: "OPEN",
				reviewRequests: {
					nodes: [{ requestedReviewer: { slug: "dev", organization: { login: "org" } } }],
					pageInfo: { hasNextPage: false },
				},
				reviews: { totalCount: 1, nodes: [{ id: "r1", state: "APPROVED", submittedAt: "today" }] },
				comments: { totalCount: 2, nodes: [{ id: "c2", updatedAt: "today" }] },
			},
			"me",
			["org/dev"]
		);
		expect(result.reviewRequested).toBe(true);
		expect(result.reviewToken).toContain("r1");
		expect(result.commentToken).toContain("c2");
		expect(result.headSha).toBe("abc");
	});
	test("Bitbucket approved/changes-requested reviewers are not outstanding requests", () => {
		const raw = {
			draft: false,
			reviewers: [{ account_id: "me" }],
			participants: [{ user: { account_id: "me" }, state: "approved", approved: true }],
		};
		expect(bitbucketActivity(raw, "me").reviewRequested).toBe(false);
		expect(
			bitbucketActivity(
				{
					...raw,
					participants: [
						{ user: { account_id: "me" }, state: "changes_requested", approved: false },
					],
				},
				"me"
			).reviewRequested
		).toBe(false);
		expect(
			bitbucketActivity(
				{ ...raw, participants: [{ user: { account_id: "me" }, state: null, approved: false }] },
				"me"
			).reviewRequested
		).toBe(true);
	});
	test("Bitbucket missing fields never imply false/zero/non-draft", () => {
		expect(bitbucketActivity({}, "me")).toEqual({});
		expect(
			bitbucketActivity({ reviewers: [{ account_id: "me" }] }, "me").reviewRequested
		).toBeUndefined();
	});
});
