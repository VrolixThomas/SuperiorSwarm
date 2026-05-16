import { describe, expect, test } from "bun:test";
import {
	DEMO_FILES_V4,
	OPENING_TERMINALS_V4,
	PRS_V4,
	REPOS_V4,
	TICKETS_V4,
} from "../src/hero/build-v4/data";

describe("data-v4", () => {
	test("REPOS_V4 only contains the real SuperiorSwarm repo (no fabricated repos)", () => {
		expect(REPOS_V4.length).toBe(1);
		for (const repo of REPOS_V4) {
			expect(repo.worktrees.length).toBeGreaterThanOrEqual(1);
		}
	});

	test("SuperiorSwarm is the first repo with 8 worktrees", () => {
		const first = REPOS_V4[0];
		expect(first?.name).toBe("SuperiorSwarm");
		expect(first?.worktrees.length).toBe(8);
	});

	test("TICKETS_V4 ids match /^SS-\\d+$/", () => {
		expect(TICKETS_V4.length).toBeGreaterThanOrEqual(5);
		for (const t of TICKETS_V4) {
			expect(t.id).toMatch(/^SS-\d+$/);
		}
	});

	test("PRS_V4 is aligned to MOCK_PR (PR#214 by alex, single incoming-review entry)", () => {
		expect(PRS_V4.length).toBe(1);
		const pr = PRS_V4[0];
		expect(pr?.number).toBe(214);
		expect(pr?.author).toBe("alex");
		expect(pr?.role).toBe("incoming-review");
		expect((pr?.comments.length ?? 0)).toBeGreaterThanOrEqual(1);
	});

	test("OPENING_TERMINALS_V4 has exactly 8 entries, 5 swarm + 3 other", () => {
		expect(OPENING_TERMINALS_V4.length).toBe(8);
		const swarm = OPENING_TERMINALS_V4.filter((t) => t.kind === "swarm");
		const other = OPENING_TERMINALS_V4.filter((t) => t.kind !== "swarm");
		expect(swarm.length).toBe(5);
		expect(other.length).toBe(3);
	});

	test("DEMO_FILES_V4 has at least 3 files each with diff hunks", () => {
		expect(DEMO_FILES_V4.length).toBeGreaterThanOrEqual(3);
		for (const f of DEMO_FILES_V4) {
			expect(f.path.length).toBeGreaterThan(0);
			expect(f.hunks.length).toBeGreaterThanOrEqual(1);
		}
	});
});
