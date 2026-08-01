import { describe, expect, test } from "bun:test";
import type { ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { removeWorktree } from "../src/main/git/operations";

describe("removeWorktree timeout", () => {
	test("terminates a wedged git process and rejects within the configured bound", async () => {
		const signals: NodeJS.Signals[] = [];
		const child = new EventEmitter() as EventEmitter & {
			stderr: PassThrough;
			kill(signal?: NodeJS.Signals): boolean;
		};
		child.stderr = new PassThrough();
		child.kill = (signal = "SIGTERM") => {
			signals.push(signal);
			if (signal === "SIGKILL") child.emit("exit", null, signal);
			return true;
		};
		const spawnProcess = (() => child as unknown as ChildProcess) as typeof spawn;

		const startedAt = Date.now();
		await expect(
			removeWorktree("/repo", "/repo-worktrees/stuck", {
				timeoutMs: 20,
				terminateGraceMs: 20,
				spawnProcess,
			})
		).rejects.toThrow("timed out after 20ms");

		expect(Date.now() - startedAt).toBeLessThan(500);
		expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
	});
});
