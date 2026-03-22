import { describe, expect, test } from "bun:test";

describe("PR poller cache", () => {
	test("detectNewPRs identifies PRs not in cache", () => {
		const cache = new Map<string, { identifier: string }>();
		cache.set("owner/repo#1", { identifier: "owner/repo#1" });

		const fetched = [{ identifier: "owner/repo#1" }, { identifier: "owner/repo#2" }];

		const newPRs = fetched.filter((pr) => !cache.has(pr.identifier));
		expect(newPRs).toHaveLength(1);
		expect(newPRs[0].identifier).toBe("owner/repo#2");
	});

	test("detectClosedPRs identifies PRs no longer in fetched list", () => {
		const cache = new Map<string, { identifier: string; state: string }>();
		cache.set("owner/repo#1", { identifier: "owner/repo#1", state: "open" });
		cache.set("owner/repo#2", { identifier: "owner/repo#2", state: "open" });

		const fetched = [
			{ identifier: "owner/repo#1", state: "open" },
			{ identifier: "owner/repo#2", state: "merged" },
		];

		const closed = fetched.filter((pr) => pr.state === "merged" || pr.state === "declined");
		expect(closed).toHaveLength(1);
	});
});
