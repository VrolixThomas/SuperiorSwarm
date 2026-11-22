import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** Disposable repositories never inherit the user's signing, hooks or credentials. */
export const fixtureGitEnv = {
	PATH: process.env["PATH"],
	GIT_CONFIG_NOSYSTEM: "1",
	GIT_CONFIG_GLOBAL: "/dev/null",
	GIT_TERMINAL_PROMPT: "0",
	GIT_NO_REPLACE_OBJECTS: "1",
	GIT_NO_LAZY_FETCH: "1",
};

export function snapshotFixture() {
	const directory = mkdtempSync(join(tmpdir(), "review-snapshot-"));
	const root = join(directory, "repo");
	mkdirSync(root);
	const git = (...args: string[]) =>
		execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
			cwd: root,
			env: fixtureGitEnv,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		}).trim();
	const write = (path: string, content: string | Buffer) => {
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), content);
	};
	const commit = () => {
		git("add", "--all");
		git("-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "fixture");
		return git("rev-parse", "HEAD");
	};
	git("init", "--initial-branch=main", "--object-format=sha1");
	git("config", "user.name", "Fixture");
	git("config", "user.email", "fixture@example.invalid");
	write("old.ts", "export const first = 1;\nexport const second = 2;\nexport const third = 3;\n");
	write("deleted.txt", "base only\n");
	const base = commit();
	git("checkout", "-b", "change");
	git("mv", "old.ts", "renamed.ts");
	git("rm", "deleted.txt");
	write("new.txt", "head only\n");
	write("empty.txt", "");
	const head = commit();
	git("checkout", "main");
	write("target-only.txt", "not part of this PR\n");
	const target = commit();
	return { directory, root, git, write, commit, base, head, target };
}
