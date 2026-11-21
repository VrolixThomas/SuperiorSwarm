import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitReadError, requireLocalCommit } from "../src/main/review-explanation/git-reader";
import { inIsolatedFileBrowserTest } from "./helpers/isolated-file-browser-test";

if (inIsolatedFileBrowserTest(import.meta.path, "bounded local runtime Git checks")) {
	test("valid local commit ignores dangerous inherited Git configuration; absent/ref/blob inputs fail", async () => {
		const root = mkdtempSync(join(tmpdir(), "runtime-git-"));
		const env = { ...process.env };
		const git = (...args: string[]) =>
			execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
		try {
			git("init", "-q");
			writeFileSync(join(root, "a"), "a\n");
			git("add", "a");
			git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "test");
			const sha = git("rev-parse", "HEAD");
			const blob = git("rev-parse", "HEAD:a");
			process.env["GIT_DIR"] = "/nonexistent";
			process.env["GIT_CONFIG_COUNT"] = "1";
			process.env["GIT_CONFIG_KEY_0"] = "core.repositoryformatversion";
			process.env["GIT_CONFIG_VALUE_0"] = "invalid";
			const signal = new AbortController().signal;
			await requireLocalCommit(root, sha, signal);
			await expect(requireLocalCommit(root, "b".repeat(40), signal)).rejects.toThrow(
				"unavailable locally"
			);
			await expect(requireLocalCommit(root, "HEAD", signal)).rejects.toThrow("full commit ID");
			await expect(requireLocalCommit(root, blob, signal)).rejects.toThrow("unavailable locally");
		} finally {
			process.env = env;
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("promisor checks cannot fetch objects through locally enabled file or HTTP transports", async () => {
		const root = mkdtempSync(join(tmpdir(), "runtime-no-fetch-"));
		let requests = 0;
		const server = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch: () => {
				requests++;
				return new Response("no");
			},
		});
		const git = (...args: string[]) =>
			execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
		try {
			git("init", "-q");
			git("config", "remote.origin.promisor", "true");
			git("config", "remote.origin.partialclonefilter", "blob:none");
			git("config", "protocol.file.allow", "always");
			git("config", "protocol.http.allow", "always");
			const before = readdirSync(join(root, ".git/objects"), { recursive: true });
			for (const url of [root, `http://127.0.0.1:${server.port}/repo`]) {
				git("config", "remote.origin.url", url);
				await expect(
					requireLocalCommit(root, "a".repeat(40), new AbortController().signal)
				).rejects.toThrow("unavailable locally");
			}
			expect(requests).toBe(0);
			expect(readdirSync(join(root, ".git/objects"), { recursive: true })).toEqual(before);
		} finally {
			server.stop(true);
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("Git timeout and cancellation kill even a process ignoring TERM without blocking the event loop", async () => {
		const root = mkdtempSync(join(tmpdir(), "runtime-git-bound-"));
		const path = process.env["PATH"];
		writeFileSync(join(root, "git"), "#!/bin/sh\ntrap '' TERM\nexec /bin/sleep 60\n", {
			mode: 0o700,
		});
		process.env["PATH"] = root;
		try {
			const controller = new AbortController();
			const pending = requireLocalCommit(root, "a".repeat(40), controller.signal);
			setTimeout(() => controller.abort(), 30);
			await expect(pending).rejects.toBeInstanceOf(GitReadError);
			const start = Date.now();
			let ticks = 0;
			const timer = setInterval(() => {
				ticks++;
			}, 20);
			try {
				await expect(
					requireLocalCommit(root, "a".repeat(40), new AbortController().signal)
				).rejects.toThrow("unavailable locally");
			} finally {
				clearInterval(timer);
			}
			expect(Date.now() - start).toBeLessThan(12_000);
			expect(ticks).toBeGreaterThan(5);
		} finally {
			process.env["PATH"] = path;
			rmSync(root, { recursive: true, force: true });
		}
	}, 13_000);
}
