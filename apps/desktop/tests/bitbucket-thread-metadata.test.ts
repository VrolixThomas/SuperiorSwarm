import { beforeEach, expect, mock, test } from "bun:test";
import { inIsolatedFileBrowserTest } from "./helpers/isolated-file-browser-test";

if (inIsolatedFileBrowserTest(import.meta.path, "Bitbucket raw thread metadata in isolation")) {
	let pages: unknown[][];
	let commentFetch: ((url: string) => Response) | null = null;
	mock.module("../src/main/atlassian/auth", () => ({
		getAuth: () => null,
		atlassianFetch: async (_service: string, url: string) => {
			if (url.includes("/comments?")) {
				if (commentFetch) return commentFetch(url);
				const index = url.endsWith("page=2") ? 1 : 0;
				return Response.json({
					values: pages[index],
					...(index === 0 && pages.length > 1
						? {
								next: "https://api.bitbucket.org/2.0/repositories/org/repo/pullrequests/1/comments?page=2",
							}
						: {}),
				});
			}
			if (url.endsWith("/pullrequests/1"))
				return Response.json({
					source: { commit: { hash: "a".repeat(40) } },
					destination: { commit: { hash: "b".repeat(40) } },
				});
			return Response.json({ values: [] });
		},
	}));
	const { BitbucketAdapter } = await import("../src/main/providers/bitbucket-adapter");
	const { getBitbucketPRComments } = await import("../src/main/atlassian/bitbucket");
	const comment = (id: number, fields: Record<string, unknown> = {}) => ({
		id,
		content: { raw: `message ${id}` },
		user: { uuid: `{user-${id}}`, display_name: "Same Name" },
		created_on: `2026-11-21T00:00:0${id}Z`,
		...fields,
	});
	beforeEach(() => {
		pages = [[]];
		commentFetch = null;
	});

	test("groups nested replies across pages under the root's original left-side anchor", async () => {
		pages = [
			[
				comment(2, { parent: { id: 1 } }),
				comment(3, { parent: { id: 2 }, inline: { path: "wrong.ts", to: 999 }, resolution: null }),
			],
			[
				comment(1, {
					inline: { path: "old.ts", from: 12, to: null, outdated: true },
					resolution: { type: "comment_resolution" },
				}),
				comment(4),
			],
		];
		const details = await new BitbucketAdapter().getPRDetails("org", "repo", 1);
		expect(details.reviewThreads).toHaveLength(1);
		expect(details.reviewThreads[0]).toMatchObject({
			id: "1",
			path: "old.ts",
			line: null,
			originalLine: 12,
			diffSide: "LEFT",
			isOutdated: true,
			isResolved: true,
			resolutionKnown: true,
		});
		expect(details.reviewThreads[0]?.comments.map((c) => c.id)).toEqual(["1", "2", "3"]);
		expect(details.reviewThreads[0]?.comments.map((c) => c.authorId)).toEqual([
			"{user-1}",
			"{user-2}",
			"{user-3}",
		]);
		expect(details.conversationComments.map((c) => c.id)).toEqual(["4"]);
	});
	test("current sides and explicit unresolved state remain separate from unknown state", async () => {
		pages = [
			[
				comment(1, {
					inline: { path: "right.ts", from: 8, to: 10, outdated: false },
					resolution: null,
				}),
				comment(2, { inline: { path: "left.ts", from: 8, to: null } }),
				comment(3, { inline: { path: "file.ts" }, resolved: true }),
			],
		];
		const { reviewThreads } = await new BitbucketAdapter().getPRDetails("org", "repo", 1);
		expect(reviewThreads[0]).toMatchObject({
			line: 10,
			diffSide: "RIGHT",
			isOutdated: false,
			isResolved: false,
			resolutionKnown: true,
		});
		expect(reviewThreads[0]?.originalLine).toBeUndefined();
		expect(reviewThreads[1]).toMatchObject({
			line: 8,
			diffSide: "LEFT",
			isResolved: false,
			resolutionKnown: false,
		});
		expect(reviewThreads[1]?.isOutdated).toBeUndefined();
		expect(reviewThreads[2]).toMatchObject({
			line: null,
			isResolved: false,
			resolutionKnown: false,
		});
	});
	test("deleted roots keep replies without resurfacing deleted bodies", async () => {
		pages = [
			[
				comment(1, {
					deleted: true,
					content: null,
					user: null,
					inline: { path: "a.ts", to: 5 },
					resolution: null,
				}),
				comment(2, { parent: { id: 1 } }),
			],
		];
		const { reviewThreads } = await new BitbucketAdapter().getPRDetails("org", "repo", 1);
		expect(reviewThreads[0]?.comments).toHaveLength(2);
		expect(reviewThreads[0]?.comments[0]).toMatchObject({
			body: "[Deleted comment]",
			authorId: null,
		});
	});
	test("missing and cyclic parents remain visible without fabricated file anchors", async () => {
		pages = [
			[
				comment(1, { parent: { id: 99 }, inline: { path: "a.ts", to: 5 } }),
				comment(2, { parent: { id: 3 } }),
				comment(3, { parent: { id: 2 } }),
			],
		];
		const details = await new BitbucketAdapter().getPRDetails("org", "repo", 1);
		expect(details.reviewThreads).toHaveLength(0);
		expect(details.conversationComments.map((c) => c.id)).toEqual(["1", "2", "3"]);
	});
	test("raw outdated comments never expose their old anchor as a current normalized line", async () => {
		pages = [[comment(1, { inline: { path: "a.ts", to: 7, outdated: true } })]];
		const [raw] = await getBitbucketPRComments("org", "repo", 1);
		expect(raw).toMatchObject({
			lineNumber: null,
			originalLine: 7,
			diffSide: "RIGHT",
			isOutdated: true,
		});
		const [normalized] = await new BitbucketAdapter().getPRComments("org", "repo", 1);
		expect(normalized).toMatchObject({ lineNumber: null, side: "RIGHT" });
	});
	test("file-level outdated comments retain unknown original line", async () => {
		pages = [[comment(1, { inline: { path: "a.ts", outdated: true }, resolution: false })]];
		const { reviewThreads } = await new BitbucketAdapter().getPRDetails("org", "repo", 1);
		expect(reviewThreads[0]).toMatchObject({
			isOutdated: true,
			line: null,
			originalLine: null,
			resolutionKnown: false,
		});
	});
	test.each(["loop", "duplicate", "failed-page"])(
		"comment collection rejects %s rather than grouping partial or ambiguous threads",
		async (failure) => {
			let calls = 0;
			commentFetch = (url) => {
				calls++;
				if (calls > 3) throw new Error("pagination did not stop");
				if (failure === "failed-page" && calls === 2) return new Response(null, { status: 503 });
				return Response.json({
					values: [comment(1, { inline: { path: "a.ts", to: 1 } })],
					...(calls === 1
						? {
								next:
									failure === "loop"
										? url
										: "https://api.bitbucket.org/2.0/repositories/org/repo/pullrequests/1/comments?page=2",
							}
						: {}),
				});
			};
			await expect(new BitbucketAdapter().getPRDetails("org", "repo", 1)).rejects.toThrow();
			expect(calls).toBeLessThanOrEqual(2);
		}
	);
}
