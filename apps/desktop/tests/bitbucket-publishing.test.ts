import { beforeEach, expect, mock, test } from "bun:test";
import { inIsolatedFileBrowserTest } from "./helpers/isolated-file-browser-test";

if (inIsolatedFileBrowserTest(import.meta.path, "Bitbucket publishing boundaries in isolation")) {
	const requests: Array<{ url: string; init?: RequestInit }> = [];
	mock.module("../src/main/atlassian/auth", () => ({
		getAuth: () => null,
		atlassianFetch: async (_service: string, url: string, init?: RequestInit) => {
			requests.push({ url, init });
			return Response.json({ id: 42 });
		},
	}));
	const { BitbucketAdapter } = await import("../src/main/providers/bitbucket-adapter");
	const { createPRComment } = await import("../src/main/atlassian/bitbucket");
	const adapter = new BitbucketAdapter();
	const input = { owner: "org", repo: "repo", prNumber: 1, body: "Accepted comment" };
	beforeEach(() => {
		requests.length = 0;
	});

	test("advertises the revision limitation to review-wide preflight", () => {
		expect(adapter.supportsPinnedInlineComments).toBe(false);
	});

	test.each(["LEFT", "RIGHT"] as const)(
		"maps %s to only the matching raw inline anchor",
		async (side) => {
			expect(
				await adapter.createInlineComment({ ...input, filePath: "src/a.ts", line: 7, side })
			).toEqual({ id: "42" });
			expect(requests).toHaveLength(1);
			expect(requests[0]?.init?.method).toBe("POST");
			expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
				content: { raw: input.body },
				inline: { path: "src/a.ts", [side === "LEFT" ? "from" : "to"]: 7 },
			});
		}
	);

	test.each([7, undefined])(
		"rejects pinned file comments (line %s) before any request",
		async (line) => {
			await expect(
				adapter.createInlineComment({
					...input,
					filePath: "src/a.ts",
					line,
					side: "LEFT",
					commitId: "a".repeat(40),
				})
			).rejects.toThrow("Bitbucket Cloud does not support revision-pinned inline comments");
			expect(requests).toEqual([]);
		}
	);

	test("retains legacy raw right-side and file-level comment payloads", async () => {
		await createPRComment("org", "repo", 1, "Line", "src/a.ts", 7);
		await adapter.createInlineComment({ ...input, filePath: "src/a.ts" });
		expect(requests.map((request) => JSON.parse(String(request.init?.body)))).toEqual([
			{ content: { raw: "Line" }, inline: { path: "src/a.ts", to: 7 } },
			{ content: { raw: input.body }, inline: { path: "src/a.ts" } },
		]);
	});

	test("body-only comments with incidental revision metadata stay body-only", async () => {
		await adapter.createInlineComment({ ...input, commitId: "a".repeat(40) });
		expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({ content: { raw: input.body } });
	});

	test.each(["COMMENT", "APPROVE", "REQUEST_CHANGES"] as const)(
		"keeps %s summary/verdict behavior",
		async (verdict) => {
			await adapter.submitReview({ ...input, verdict, body: " Summary " });
			expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({ content: { raw: "Summary" } });
			expect(requests[0]?.url.endsWith("/comments")).toBe(true);
			expect(requests).toHaveLength(verdict === "COMMENT" ? 1 : 2);
			if (verdict !== "COMMENT") {
				expect(
					requests[1]?.url.endsWith(verdict === "APPROVE" ? "/approve" : "/request-changes")
				).toBe(true);
				expect(requests[1]?.init?.method).toBe("POST");
			}
		}
	);
}
