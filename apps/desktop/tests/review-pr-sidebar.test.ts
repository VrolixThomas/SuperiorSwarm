import { expect, test } from "bun:test";
import type { BitbucketPullRequest } from "../src/main/atlassian/bitbucket";
import {
	buildAuthoredReviewPRs,
	filterReviewSidebarRows,
	parseReviewSidebarFilters,
} from "../src/renderer/lib/review-sidebar";
const bb: BitbucketPullRequest = {
	id: 12,
	title: "My change",
	state: "OPEN",
	author: "Me",
	repoSlug: "repo",
	workspace: "owner",
	webUrl: "https://example.test",
	createdOn: "",
	updatedOn: "",
	headCommitSha: "abc",
};
test("authored rows use an authored provider source and deduplicate identities", () => {
	const rows = buildAuthoredReviewPRs({ bitbucket: [bb, bb, { ...bb, id: 13, state: "MERGED" }] });
	expect(rows.map((row) => row.key)).toEqual(["bitbucket:owner/repo#12"]);
});
test("sidebar filtering searches repository, number, title and author without changing queue order", () => {
	const rows = buildAuthoredReviewPRs({
		bitbucket: [bb, { ...bb, id: 14, title: "Another", repoSlug: "other" }],
	});
	expect(
		filterReviewSidebarRows(rows, { search: "#12", repository: "" }).map((row) => row.number)
	).toEqual([12]);
	expect(
		filterReviewSidebarRows(rows, { search: "me", repository: "bitbucket:owner/repo" }).map(
			(row) => row.number
		)
	).toEqual([12]);
});
test("persisted section and filter parsing rejects malformed values", () => {
	expect(parseReviewSidebarFilters("not json")).toEqual({
		search: "",
		repository: "",
		sections: { needsReview: true, authored: false, waitingOnAuthor: false },
	});
	expect(
		parseReviewSidebarFilters('{"search":"bug","repository":1,"sections":{"authored":true}}')
	).toEqual({
		search: "bug",
		repository: "",
		sections: { needsReview: true, authored: true, waitingOnAuthor: false },
	});
});
