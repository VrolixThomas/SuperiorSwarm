import "./preload-electron-mock";
import { beforeEach, expect, mock, test } from "bun:test";
let failSecond = false;
const calls: string[] = [];
mock.module("../src/main/github/auth", () => ({
	getAuth: () => ({ accountId: "me" }),
	getValidToken: async () => "synthetic",
	githubGraphQL: async () => {
		throw new Error("Unexpected GraphQL");
	},
	githubFetch: async (path: string) => {
		calls.push(path);
		if (path.includes("/pulls/")) return Response.json([]);
		if (path.includes("page=2")) {
			if (failSecond) return new Response("unavailable", { status: 503 });
			return Response.json([{ id: 2, body: "second page", user: { login: "reviewer" } }]);
		}
		return Response.json([{ id: 1, body: "first page", user: { login: "reviewer" } }], {
			headers: { link: '<https://api.github.com/ignored>; rel="next"', etag: "first" },
		});
	},
}));
const { GitHubAdapter } = await import("../src/main/providers/github-adapter");
beforeEach(() => {
	failSecond = false;
	calls.length = 0;
});
test("forced solver comment refresh reads every page before returning", async () => {
	const result = await new GitHubAdapter().getPRCommentsIfChanged("owner", "repo", 7);
	expect(result.changed && result.comments.map((c) => c.body)).toEqual([
		"first page",
		"second page",
	]);
	expect(calls).toContain("/repos/owner/repo/issues/7/comments?per_page=100&page=2");
});
test("later page failure never certifies the partial first page", async () => {
	failSecond = true;
	await expect(new GitHubAdapter().getPRCommentsIfChanged("owner", "repo", 7)).rejects.toThrow(
		"refresh failed"
	);
});
