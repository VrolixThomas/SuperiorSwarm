import "./preload-electron-mock";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { ReviewSnapshotService } from "../src/main/review-explanation/snapshot";
import { createReviewExplanationRouter } from "../src/main/trpc/routers/review-explanation";
import { snapshotFixture } from "./helpers/review-snapshot-fixture";

let fixture: ReturnType<typeof snapshotFixture>;
beforeEach(() => {
	fixture = snapshotFixture();
});
afterEach(() => rmSync(fixture.directory, { recursive: true, force: true }));

function caller() {
	return createReviewExplanationRouter(
		new ReviewSnapshotService({
			resolveRoot: async (workspaceId) => {
				if (workspaceId !== "registered") throw new Error("internal root must not leak");
				return fixture.root;
			},
		})
	).createCaller({});
}

test("reads a pinned file through the registered-workspace router", async () => {
	const api = caller();
	const snapshot = await api.resolveSnapshot({
		workspaceId: "registered",
		targetTipOid: fixture.target,
		headOid: fixture.head,
	});
	const file = snapshot.files.find((entry) => entry.path === "renamed.ts");
	if (!file) throw new Error("missing rename");
	expect(
		await api.getSnapshotFile({
			workspaceId: "registered",
			snapshotId: snapshot.id,
			fileId: file.id,
			side: "base",
		})
	).toMatchObject({ kind: "text", path: "old.ts" });
});

test("rejects arbitrary roots, ref expressions, unknown workspaces and invalid sides", async () => {
	const api = caller();
	const input = { workspaceId: "registered", targetTipOid: fixture.target, headOid: fixture.head };
	await expect(api.resolveSnapshot({ ...input, repoPath: "/" } as typeof input)).rejects.toThrow();
	await expect(api.resolveSnapshot({ ...input, headOid: "HEAD" })).rejects.toThrow();
	await expect(api.resolveSnapshot({ ...input, workspaceId: "unknown" })).rejects.toThrow(
		"Review workspace is unavailable"
	);
	const snapshot = await api.resolveSnapshot(input);
	const read = {
		workspaceId: "registered",
		snapshotId: snapshot.id,
		fileId: snapshot.files[0]?.id ?? "",
		side: "head" as const,
	};
	await expect(
		api.getSnapshotFile({ ...read, side: "working" } as unknown as typeof read)
	).rejects.toThrow();
	await expect(api.getSnapshotFile({ ...read, workspaceId: "unknown" })).rejects.toThrow();
});
