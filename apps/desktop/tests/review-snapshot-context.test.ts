import { afterEach, beforeEach, expect, test } from "bun:test";
import { rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { ReviewSnapshotService } from "../src/main/review-explanation/snapshot";
import { snapshotFixture } from "./helpers/review-snapshot-fixture";

let fixture: ReturnType<typeof snapshotFixture>;
let service: ReviewSnapshotService;
beforeEach(() => {
	fixture = snapshotFixture();
	service = new ReviewSnapshotService({ resolveRoot: async () => fixture.root });
});
afterEach(() => rmSync(fixture.directory, { recursive: true, force: true }));
async function context(path: string, side: "head" | "base" = "head") {
	const snapshot = await service.create({
		workspaceId: "ws",
		targetTipOid: fixture.target,
		headOid: fixture.head,
	});
	return service.readContext({ workspaceId: "ws", snapshotId: snapshot.id, path, side });
}
test("unchanged context is read at the snapshot commit, never the worktree or moved branch", async () => {
	fixture.git("checkout", "change");
	fixture.write("context.ts", "\uFEFFconst context = 1;\r\n");
	const common = fixture.commit();
	fixture.write("new.txt", "next head");
	fixture.head = fixture.commit();
	fixture.target = common;
	fixture.write("context.ts", "mutable sentinel");
	fixture.git("update-ref", "refs/heads/change", fixture.base);
	expect(await context("context.ts")).toMatchObject({
		kind: "text",
		content: "\uFEFFconst context = 1;\r\n",
	});
	expect(await context("empty.txt")).toMatchObject({ kind: "text", content: "" });
	expect(await context("missing.ts")).toEqual({ kind: "absent" });
});
test("context uses merge base on the left and handles literal unusual paths", async () => {
	expect(await context("target-only.txt", "base")).toEqual({ kind: "absent" });
	expect(await context("old.ts", "base")).toMatchObject({ kind: "text" });
	fixture.git("checkout", "change");
	fixture.write("literal[1]\t\n.ts", "literal");
	fixture.head = fixture.commit();
	expect(await context("literal[1]\t\n.ts")).toMatchObject({ kind: "text", content: "literal" });
});
test("context rejects traversal, pathspecs, absolute paths, invalid side and foreign ownership", async () => {
	const snapshot = await service.create({
		workspaceId: "ws",
		targetTipOid: fixture.target,
		headOid: fixture.head,
	});
	const input = {
		workspaceId: "ws",
		snapshotId: snapshot.id,
		path: "new.txt",
		side: "head" as const,
	};
	for (const path of [
		"",
		"../outside",
		"/etc/passwd",
		"a/../../outside",
		"a//b",
		"a/./b",
		"a\0b",
		"C:\\outside",
		"a\\..\\b",
	]) {
		await expect(service.readContext({ ...input, path })).rejects.toMatchObject({
			code: "FILE_UNAVAILABLE",
		});
	}
	expect(await service.readContext({ ...input, path: ":(glob)**" })).toEqual({ kind: "absent" });
	await expect(service.readContext({ ...input, workspaceId: "foreign" })).rejects.toMatchObject({
		code: "SNAPSHOT_UNAVAILABLE",
	});
	await expect(service.readContext({ ...input, side: "working" as "head" })).rejects.toMatchObject({
		code: "FILE_UNAVAILABLE",
	});
	service = new ReviewSnapshotService({ resolveRoot: async () => fixture.directory });
	await expect(service.readContext(input)).rejects.toMatchObject({ code: "SNAPSHOT_UNAVAILABLE" });
});
test("context never follows links and preserves omission and missing-object states", async () => {
	fixture.git("checkout", "change");
	fixture.write("outside.txt", "sentinel");
	symlinkSync(join(fixture.root, "outside.txt"), join(fixture.root, "link"));
	symlinkSync(fixture.directory, join(fixture.root, "directory-link"));
	fixture.write("binary", Buffer.from([0, 1]));
	fixture.write("large", "x".repeat(1024 * 1024 + 1));
	fixture.head = fixture.commit();
	expect(await context("link")).toMatchObject({ kind: "omitted", reason: "symlink" });
	expect(await context("directory-link/repo/outside.txt")).toEqual({ kind: "absent" });
	expect(await context("binary")).toMatchObject({ kind: "omitted", reason: "binary" });
	expect(await context("large")).toMatchObject({ kind: "omitted", reason: "too-large" });
	const blob = fixture.git("rev-parse", `${fixture.head}:outside.txt`);
	rmSync(join(fixture.root, ".git", "objects", blob.slice(0, 2), blob.slice(2)));
	expect(await context("outside.txt")).toMatchObject({
		kind: "unavailable",
		reason: "object-unavailable",
	});
});

test("context retains root binding, cancellation and cache eviction safeguards", async () => {
	let root = fixture.root;
	service = new ReviewSnapshotService({ resolveRoot: async () => root, maxSnapshots: 1 });
	const revision = { workspaceId: "ws", targetTipOid: fixture.target, headOid: fixture.head };
	const snapshot = await service.create(revision);
	const input = {
		workspaceId: "ws",
		snapshotId: snapshot.id,
		path: "new.txt",
		side: "head" as const,
	};
	root = fixture.directory;
	await expect(service.readContext(input)).rejects.toMatchObject({ code: "WORKSPACE_CHANGED" });
	root = fixture.root;
	const controller = new AbortController();
	controller.abort();
	await expect(service.readContext(input, controller.signal)).rejects.toMatchObject({
		code: "CANCELLED",
	});
	await service.create({ ...revision, headOid: fixture.base });
	await expect(service.readContext(input)).rejects.toMatchObject({ code: "SNAPSHOT_UNAVAILABLE" });
});

test("a missing context tree is unavailable rather than an absent file", async () => {
	const snapshot = await service.create({
		workspaceId: "ws",
		targetTipOid: fixture.target,
		headOid: fixture.head,
	});
	const tree = fixture.git("rev-parse", `${fixture.head}^{tree}`);
	rmSync(join(fixture.root, ".git", "objects", tree.slice(0, 2), tree.slice(2)));
	await expect(
		service.readContext({
			workspaceId: "ws",
			snapshotId: snapshot.id,
			path: "new.txt",
			side: "head",
		})
	).rejects.toMatchObject({ code: "OBJECT_UNAVAILABLE" });
});
