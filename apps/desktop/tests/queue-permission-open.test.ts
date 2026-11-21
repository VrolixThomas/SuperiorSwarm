import { expect, test } from "bun:test";
import type { WorkspaceQueueItem } from "../src/shared/activity-queue";
import { releaseQueuePermissionForOpen } from "../src/shared/queue-permission-open";
const item = {
	id: "permission",
	revision: 4,
	members: [
		{ id: "permission", revision: 4 },
		{ id: "report", revision: 7 },
	],
	permission: { requestId: "exact", outcome: "pending" },
} as WorkspaceQueueItem;
test("explicit permission Open releases exact displayed receipt without deciding", async () => {
	const calls: unknown[] = [];
	await releaseQueuePermissionForOpen(item, {
		capability: async (input) => {
			calls.push(input);
			return {
				capability: "hook-response",
				state: "waiting",
				requestId: "exact",
				detail: "Waiting",
			};
		},
		decide: async (input) => {
			calls.push(input);
			return { status: "opened", detail: "Native prompt" };
		},
	});
	expect(calls).toEqual([
		{ id: item.id, revision: 4, members: item.members },
		{ id: item.id, revision: 4, members: item.members, requestId: "exact", action: "open" },
	]);
});
test("expired/unsupported/non-permission Open performs no decision", async () => {
	for (const target of [item, { ...item, permission: undefined }]) {
		await releaseQueuePermissionForOpen(target, {
			capability: async () => ({ capability: "unavailable", detail: "Expired" }),
			decide: async () => {
				throw Error("must not decide");
			},
		});
	}
});
test("uncertain release blocks navigation instead of silently claiming native prompt", async () => {
	await expect(
		releaseQueuePermissionForOpen(item, {
			capability: async () => ({
				capability: "hook-response",
				state: "waiting",
				requestId: "exact",
				detail: "Waiting",
			}),
			decide: async () => ({ status: "uncertain", detail: "Check the request" }),
		})
	).rejects.toThrow("Check the request");
});
test("unavailable after a live wait was observed cannot silently navigate with that wait held", async () => {
	await expect(
		releaseQueuePermissionForOpen(item, {
			capability: async () => ({
				capability: "hook-response",
				state: "waiting",
				requestId: "exact",
				detail: "Waiting",
			}),
			decide: async () => ({ status: "unavailable", detail: "Inventory disconnected" }),
		})
	).rejects.toThrow("Inventory disconnected");
});
