import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { resolveReviewMergeBase } from "../src/main/review-path/revisions";
import { fixtureGitEnv, snapshotFixture } from "./helpers/review-snapshot-fixture";

test("agent diff uses verified merge base and excludes destination-only changes", async () => {
	const fixture = snapshotFixture();
	try {
		const base = await resolveReviewMergeBase(
			fixture.root,
			fixture.head,
			fixture.target,
			new AbortController().signal
		);
		expect(base).not.toBe(fixture.target);
		const git = (...args: string[]) =>
			execFileSync("git", args, { cwd: fixture.root, env: fixtureGitEnv, encoding: "utf8" });
		expect(base).toBe(git("merge-base", fixture.head, fixture.target).trim());
		const changed = git("diff", "--name-only", base, fixture.head);
		expect(changed).not.toBe(git("diff", "--name-only", fixture.target, fixture.head));
	} finally {
		rmSync(fixture.directory, { recursive: true, force: true });
	}
});
