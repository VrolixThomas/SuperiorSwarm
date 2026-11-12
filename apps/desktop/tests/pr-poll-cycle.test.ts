import { expect, test } from "bun:test";
import { PRConfirmationBudget, coalescePoll } from "../src/main/ai-review/pr-poll-cycle";
import { buildUpdateSet, deduplicatePRs } from "../src/main/ai-review/pr-poller";
import type { NormalizedPR } from "../src/main/providers/types";
import type { CachedPR } from "../src/shared/review-types";
test("overlapping polls share one flight and failures permit retry", async () => {
	let release: () => void = () => {};
	let calls = 0;
	const poll = coalescePoll(async () => {
		calls++;
		await new Promise<void>((resolve) => {
			release = resolve;
		});
	});
	const first = poll();
	const second = poll();
	expect(first).toBe(second);
	await Promise.resolve();
	expect(calls).toBe(1);
	release();
	await first;
	const third = poll();
	await Promise.resolve();
	expect(calls).toBe(2);
	release();
	await third;
	let attempts = 0;
	const failing = coalescePoll(async () => {
		attempts++;
		throw new Error("fail");
	});
	await expect(failing()).rejects.toThrow();
	await expect(failing()).rejects.toThrow();
	expect(attempts).toBe(2);
});
test("disappearance confirmations are bounded, rotate, and back off failures", async () => {
	const budget = new PRConfirmationBudget();
	const candidates = Array.from({ length: 20 }, (_, i) => ({ key: String(i) }));
	let inFlight = 0;
	let maxInFlight = 0;
	const visited: string[] = [];
	const check = async (c: { key: string }) => {
		visited.push(c.key);
		inFlight++;
		maxInFlight = Math.max(maxInFlight, inFlight);
		await Promise.resolve();
		inFlight--;
		throw new Error("offline");
	};
	await budget.run(candidates, check, 0);
	expect(visited).toHaveLength(8);
	expect(maxInFlight).toBeLessThanOrEqual(4);
	await budget.run(candidates, check, 1);
	expect(visited).toHaveLength(16);
	await budget.run(candidates, check, 2);
	expect(visited).toHaveLength(20);
	await budget.run(candidates, check, 59_999);
	expect(visited).toHaveLength(20);
	await budget.run(candidates, check, 60_000);
	expect(visited).toHaveLength(28);
	await budget.run(candidates.slice(0, 8), check, 179_999);
	expect(visited).toHaveLength(28);
	await budget.run(candidates.slice(0, 8), check, 180_000);
	expect(visited).toHaveLength(36);
});
test("listing dedupe uses repository and failed enrichment omits head update", () => {
	const base = { id: 1, repoOwner: "o", repoName: "a" } as NormalizedPR;
	expect(deduplicatePRs([base, { ...base, repoName: "b" }, base])).toHaveLength(2);
	const update = buildUpdateSet(
		{ headCommitSha: "", author: { login: "a", avatarUrl: "" } } as CachedPR,
		new Date()
	);
	expect(Object.hasOwn(update, "headCommitSha")).toBe(false);
	expect(
		buildUpdateSet(
			{ headCommitSha: "known", author: { login: "a", avatarUrl: "" } } as CachedPR,
			new Date()
		).headCommitSha
	).toBe("known");
});
