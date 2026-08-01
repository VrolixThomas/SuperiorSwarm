import { afterEach, describe, expect, mock, test } from "bun:test";
import type { ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const logError = mock(() => {});
mock.module("../src/main/logger", () => ({
	log: {
		debug: mock(() => {}),
		info: mock(() => {}),
		warn: mock(() => {}),
		error: logError,
	},
}));

const { CleanupDaemonClient } = await import("../src/main/services/cleanup-daemon-client");

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
	logError.mockClear();
});

describe("CleanupDaemonClient", () => {
	test("coalesces wakes while a cleanup worker is active", async () => {
		const root = mkdtempSync(join(tmpdir(), "ss-cleanup-daemon-client-"));
		roots.push(root);
		const scriptPath = join(root, "cleanup-worker.js");
		writeFileSync(scriptPath, "");

		const children: EventEmitter[] = [];
		const spawnProcess = mock(() => {
			const child = new EventEmitter() as EventEmitter & { unref(): void };
			child.unref = mock(() => {});
			children.push(child);
			return child as unknown as ChildProcess;
		}) as unknown as typeof spawn;
		const client = new CleanupDaemonClient(
			join(root, "cleanup.db"),
			scriptPath,
			join(root, "logs", "cleanup.log"),
			{ spawnProcess }
		);

		client.wake();
		await new Promise((resolve) => setImmediate(resolve));
		expect(children).toHaveLength(1);

		client.wake();
		client.wake();
		await new Promise((resolve) => setImmediate(resolve));
		expect(children).toHaveLength(1);

		children[0]?.emit("exit", 0, null);
		await new Promise((resolve) => setImmediate(resolve));
		expect(children).toHaveLength(2);
	});

	test("logs and retries an asynchronous worker spawn error", async () => {
		const root = mkdtempSync(join(tmpdir(), "ss-cleanup-daemon-client-"));
		roots.push(root);
		const scriptPath = join(root, "cleanup-worker.js");
		writeFileSync(scriptPath, "");

		const children: EventEmitter[] = [];
		const spawnProcess = mock(() => {
			const child = new EventEmitter() as EventEmitter & { unref(): void };
			child.unref = mock(() => {});
			children.push(child);
			return child as unknown as ChildProcess;
		}) as unknown as typeof spawn;
		const scheduled: Array<{
			callback: () => void;
			delayMs: number;
			unref: ReturnType<typeof mock>;
		}> = [];
		const scheduleRetry = (callback: () => void, delayMs: number) => {
			const unref = mock(() => {});
			scheduled.push({ callback, delayMs, unref });
			return { unref };
		};
		const client = new CleanupDaemonClient(
			join(root, "cleanup.db"),
			scriptPath,
			join(root, "logs", "cleanup.log"),
			{ spawnProcess, scheduleRetry }
		);

		client.wake();
		await new Promise((resolve) => setImmediate(resolve));
		expect(children).toHaveLength(1);

		expect(() => children[0]?.emit("error", new Error("spawn EAGAIN"))).not.toThrow();
		expect(logError).toHaveBeenCalledWith(
			"[cleanup-daemon-client] worker process error",
			expect.any(Error)
		);
		expect(scheduled).toHaveLength(1);
		expect(scheduled[0]?.delayMs).toBe(1_000);
		expect(scheduled[0]?.unref).toHaveBeenCalledTimes(1);
		children[0]?.emit("exit", 1, null);
		expect(scheduled).toHaveLength(1);

		scheduled[0]?.callback();
		await new Promise((resolve) => setImmediate(resolve));
		expect(children).toHaveLength(2);
	});
});
