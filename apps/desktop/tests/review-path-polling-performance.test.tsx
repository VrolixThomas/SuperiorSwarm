import { expect, test } from "bun:test";
import type { ReviewPathTransport } from "../src/renderer/lib/review-path-source";
import type { ReviewPathIdentity, ReviewPathSnapshot } from "../src/shared/review-path-runtime";
import { inIsolatedFileBrowserTest } from "./helpers/isolated-file-browser-test";

if (inIsolatedFileBrowserTest(import.meta.path, "reading path shared polling performance")) {
	const { createLiveReviewPathController, useLiveReviewPath } = await import(
		"../src/renderer/lib/review-path-source"
	);
	const { PR129_PATH } = await import("../src/renderer/lib/review-path-fixtures");
	const identity: ReviewPathIdentity = {
		workspaceId: "polling-performance",
		provider: "github",
		owner: "o",
		repo: "r",
		prNumber: 1,
		headSha: "a".repeat(40),
	};
	const snapshot: ReviewPathSnapshot = {
		identity,
		path: { ...PR129_PATH, headSha: identity.headSha },
		pathVersion: 1,
		conversationId: "c",
		runs: [],
		questions: [],
		messages: [],
	};
	function transport(get: ReviewPathTransport["get"]): ReviewPathTransport {
		return {
			get,
			start: async () => ({ snapshot }),
			ask: async () => ({ snapshot }),
			cancel: async () => snapshot,
			cancelQuestion: async () => snapshot,
			addContext: async () => snapshot,
			removeContext: async () => snapshot,
		};
	}

	test("concurrent readers share one in-flight transport request", async () => {
		let reads = 0;
		let release!: (snapshot: ReviewPathSnapshot) => void;
		const pending = new Promise<ReviewPathSnapshot>((resolve) => {
			release = resolve;
		});
		const controller = createLiveReviewPathController(
			identity,
			transport(() => {
				reads++;
				return pending;
			})
		);
		const requests = [controller.refresh(), controller.refresh(), controller.refresh()];
		console.log("polling benchmark concurrent transport reads", reads);
		release(snapshot);
		await Promise.all(requests);
		expect(reads).toBe(1);
	});

	test("unchanged cloned snapshots preserve state identity and do not rerender subscribers", async () => {
		const controller = createLiveReviewPathController(
			identity,
			transport(async () => structuredClone(snapshot))
		);
		let notifications = 0;
		controller.subscribe(() => {
			notifications++;
		});
		await controller.refresh();
		const first = controller.getSnapshot();
		for (let index = 0; index < 20; index++) await controller.refresh();
		console.log("polling benchmark notifications for 21 unchanged snapshots", notifications);
		expect(notifications).toBe(1);
		expect(controller.getSnapshot()).toBe(first);
	});

	test("a conversation update preserves unchanged path references used by the editor", async () => {
		let next = structuredClone(snapshot);
		const controller = createLiveReviewPathController(
			identity,
			transport(async () => next)
		);
		await controller.refresh();
		const before = controller.getSnapshot().snapshot;
		next = {
			...structuredClone(snapshot),
			messages: [{ id: "m", role: "user", text: "Why?", createdAt: "2026-11-22T00:00:00Z" }],
		};
		await controller.refresh();
		expect(controller.getSnapshot().snapshot?.messages).toHaveLength(1);
		expect(controller.getSnapshot().snapshot?.path).toBe(before?.path);
		expect(controller.getSnapshot().snapshot?.runs).toBe(before?.runs);
	});

	test("three mounted consumers and an observer start only one IPC read", async () => {
		const { renderBrowserTest } = await import("./helpers/file-browser-renderer");
		function Consumer({ observeOnly = false }: { observeOnly?: boolean }) {
			useLiveReviewPath({ ...identity, workspaceId: "polling-mounted" }, { observeOnly });
			return null;
		}
		let reads = 0;
		const h = await renderBrowserTest(
			<>
				<Consumer />
				<Consumer />
				<Consumer />
				<Consumer observeOnly />
			</>,
			[],
			false,
			{
				request: (path, input) => {
					if (path !== "reviewPath.get") throw Error(path);
					reads++;
					return {
						...structuredClone(snapshot),
						identity: (input as { identity: ReviewPathIdentity }).identity,
					};
				},
			}
		);
		try {
			await h.settle();
			console.log("polling benchmark mounted consumer IPC reads", reads);
			expect(reads).toBe(1);
		} finally {
			await h.cleanup();
		}
	});

	test("one timer serves retained consumers and stops after the last consumer leaves", async () => {
		const scheduled = new Set<{ callback: () => void; delay: number }>();
		let reads = 0;
		const controller = createLiveReviewPathController(
			identity,
			transport(async () => {
				reads++;
				return structuredClone(snapshot);
			}),
			{
				schedulePoll: (callback, delay) => {
					const task = { callback, delay };
					scheduled.add(task);
					return () => {
						scheduled.delete(task);
					};
				},
			}
		);
		const releases = [
			controller.retainPolling(),
			controller.retainPolling(),
			controller.retainPolling(),
		];
		await controller.refresh();
		expect(reads).toBe(1);
		expect(scheduled.size).toBe(1);
		releases[0]?.();
		releases[1]?.();
		const task = [...scheduled][0];
		expect(task?.delay).toBe(1500);
		if (!task) throw Error("Missing scheduled poll");
		scheduled.delete(task);
		task.callback();
		await controller.refresh();
		expect(reads).toBe(2);
		expect(scheduled.size).toBe(1);
		releases[2]?.();
		releases[2]?.();
		expect(scheduled.size).toBe(0);
	});

	test("persistent errors back off without repeated renderer notifications and recover", async () => {
		let task: { callback: () => void; delay: number } | undefined;
		let offline = true;
		const controller = createLiveReviewPathController(
			identity,
			transport(async () => {
				if (offline) throw Error("backend unavailable");
				return structuredClone(snapshot);
			}),
			{
				schedulePoll: (callback, delay) => {
					task = { callback, delay };
					return () => {
						task = undefined;
					};
				},
			}
		);
		let notifications = 0;
		controller.subscribe(() => {
			notifications++;
		});
		const release = controller.retainPolling();
		try {
			await controller.refresh();
			const delays: number[] = [];
			for (let index = 0; index < 5; index++) {
				if (!task) throw Error("Missing retry");
				delays.push(task.delay);
				task.callback();
				await controller.refresh();
			}
			expect(delays).toEqual([3000, 6000, 12000, 24000, 30000]);
			expect(notifications).toBe(1);
			offline = false;
			task?.callback();
			await controller.refresh();
			expect(task?.delay).toBe(1500);
			expect(controller.getSnapshot().available).toBe(true);
			expect(controller.getSnapshot().error).toBeUndefined();
			expect(notifications).toBe(2);
		} finally {
			release();
		}
	});

	test("unmount during a slow read prevents a late result from restarting polling", async () => {
		let resolve!: (value: ReviewPathSnapshot) => void;
		const pending = new Promise<ReviewPathSnapshot>((release) => {
			resolve = release;
		});
		let schedules = 0;
		const controller = createLiveReviewPathController(
			identity,
			transport(() => pending),
			{
				schedulePoll: () => {
					schedules++;
					return () => {};
				},
			}
		);
		const stop = controller.retainPolling();
		const read = controller.refresh();
		expect(schedules).toBe(0);
		stop();
		resolve(snapshot);
		await read;
		expect(schedules).toBe(0);
	});
}
