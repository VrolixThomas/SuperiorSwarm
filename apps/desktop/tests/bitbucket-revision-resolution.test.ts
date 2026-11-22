import { beforeEach, expect, mock, test } from "bun:test";
import { inIsolatedFileBrowserTest } from "./helpers/isolated-file-browser-test";

if (inIsolatedFileBrowserTest(import.meta.path, "Bitbucket exact revision resolution")) {
	const head = "a".repeat(40);
	const base = "b".repeat(40);
	const moved = "c".repeat(40);
	let calls: string[] = [];
	let respond: (url: string) => Response;
	mock.module("../src/main/atlassian/auth", () => ({
		getAuth: () => null,
		atlassianFetch: async (_service: string, url: string) => {
			calls.push(url);
			return respond(url);
		},
	}));
	const { getBitbucketPRDetails, getPRState } = await import("../src/main/atlassian/bitbucket");
	const { BitbucketAdapter } = await import("../src/main/providers/bitbucket-adapter");
	const metadata = (source = head.slice(0, 12), destination = base.slice(0, 12)) => ({
		state: "OPEN",
		source: { commit: { hash: source }, repository: { full_name: "fork/source" } },
		destination: { commit: { hash: destination }, repository: { full_name: "org/repo" } },
	});
	beforeEach(() => {
		calls = [];
		respond = (url) => {
			if (url.endsWith("/pullrequests/1")) return Response.json(metadata());
			if (url.endsWith(`/fork/source/commit/${head.slice(0, 12)}`))
				return Response.json({ hash: head });
			if (url.endsWith(`/org/repo/commit/${base.slice(0, 12)}`))
				return Response.json({ hash: base });
			throw Error(`Unexpected fixture request: ${url}`);
		};
	});

	test("resolves abbreviated source and destination hashes in their respective repositories", async () => {
		expect(await getBitbucketPRDetails("org", "repo", 1)).toMatchObject({
			headCommitOid: head,
			baseCommitOid: base,
		});
		expect(calls).toHaveLength(3);
	});

	test("state polling uses the same exact source revision as detail reads", async () => {
		expect(await getPRState("org", "repo", 1)).toEqual({ headSha: head, state: "OPEN" });
		expect(calls).toHaveLength(2);
	});

	test.each([40, 64])("already complete %s-character OIDs require no expansion", async (length) => {
		respond = () => Response.json(metadata("a".repeat(length), "b".repeat(length)));
		expect(await getBitbucketPRDetails("org", "repo", 1)).toMatchObject({
			headCommitOid: "a".repeat(length),
			baseCommitOid: "b".repeat(length),
		});
		expect(calls).toHaveLength(1);
	});

	test("missing or mutable ref values remain unknown without branch-tip fallback", async () => {
		respond = () => Response.json(metadata("feature/branch", ""));
		expect(await getBitbucketPRDetails("org", "repo", 1)).toMatchObject({
			headCommitOid: "",
			baseCommitOid: undefined,
		});
		expect(calls).toHaveLength(1);
	});

	test.each(["mismatch", "short", "missing", "forbidden"])(
		"%s lookup result is never exposed as a verified revision",
		async (kind) => {
			respond = (url) => {
				if (url.endsWith("/pullrequests/1"))
					return Response.json(metadata(head.slice(0, 12), base));
				return kind === "forbidden"
					? new Response(null, { status: 403 })
					: Response.json({
							hash: kind === "mismatch" ? moved : kind === "short" ? head.slice(0, 12) : undefined,
						});
			};
			expect((await getBitbucketPRDetails("org", "repo", 1)).headCommitOid).toBe("");
			await expect(getPRState("org", "repo", 1)).rejects.toThrow("revision unavailable");
		}
	);

	test("uses PR repository only when side repository is absent", async () => {
		respond = (url) => {
			if (url.endsWith("/pullrequests/1"))
				return Response.json({ source: { commit: { hash: head.slice(0, 12) } } });
			expect(url.endsWith(`/org/repo/commit/${head.slice(0, 12)}`)).toBe(true);
			return Response.json({ hash: head });
		};
		expect((await getBitbucketPRDetails("org", "repo", 1)).headCommitOid).toBe(head);
	});

	test.each(["stable", "head", "base", "same-prefix"])(
		"file manifest is fenced by expanded revisions (%s)",
		async (scenario) => {
			let reads = 0;
			respond = (url) => {
				if (url.endsWith("/pullrequests/1")) {
					reads++;
					return Response.json(
						metadata(
							(scenario === "head" && reads > 1 ? moved : head).slice(0, 12),
							(scenario === "base" && reads > 1 ? moved : base).slice(0, 12)
						)
					);
				}
				if (url.includes("/commit/")) {
					const prefix = url.split("/").at(-1);
					if (scenario === "same-prefix" && reads > 1 && prefix === head.slice(0, 12))
						return Response.json({ hash: `${head.slice(0, 12)}${"d".repeat(28)}` });
					return Response.json({
						hash: [head, base, moved].find((oid) => oid.startsWith(prefix ?? "")),
					});
				}
				return Response.json({ values: [], size: 0 });
			};
			const details = new BitbucketAdapter().getPRDetails("org", "repo", 1);
			if (scenario !== "stable")
				await expect(details).rejects.toThrow("revision unavailable or changed");
			else
				expect(await details).toMatchObject({
					headCommitOid: head,
					baseCommitOid: base,
					filesComplete: true,
				});
		}
	);
}
