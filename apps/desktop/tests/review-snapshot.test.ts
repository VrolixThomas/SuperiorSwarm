import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readGit } from "../src/main/review-explanation/git-reader";
import { ReviewSnapshotService } from "../src/main/review-explanation/snapshot";
import { snapshotFixture } from "./helpers/review-snapshot-fixture";

let fixture: ReturnType<typeof snapshotFixture>;
let service: ReviewSnapshotService;
beforeEach(() => {
	fixture = snapshotFixture();
	service = new ReviewSnapshotService({ resolveRoot: async () => fixture.root });
});
afterEach(() => rmSync(fixture.directory, { recursive: true, force: true }));
const request = () => ({ workspaceId: "ws", targetTipOid: fixture.target, headOid: fixture.head });

async function read(path: string, side: "base" | "head") {
	const snapshot = await service.create(request());
	const file = snapshot.files.find((entry) => entry.path === path);
	if (!file) throw new Error(`Missing fixture entry: ${path}`);
	return service.read({ workspaceId: "ws", snapshotId: snapshot.id, fileId: file.id, side });
}

describe("immutable review snapshots", () => {
	test("uses merge base, preserves rename identity and is deterministic", async () => {
		const first = await service.create(request());
		const second = await service.create(request());
		expect(first).toEqual(second);
		expect(first.mergeBaseOid).toBe(fixture.base);
		expect(first.targetTipOid).toBe(fixture.target);
		expect(first.headOid).toBe(fixture.head);
		expect(first.files.map((file) => file.path)).toEqual([
			"deleted.txt",
			"empty.txt",
			"new.txt",
			"renamed.ts",
		]);
		expect(first.files.find((file) => file.path === "renamed.ts")).toMatchObject({
			status: "renamed",
			oldPath: "old.ts",
			base: { mode: "100644" },
			head: { mode: "100644" },
		});
	});

	test("reads both rename sides by blob, unaffected by branch movement or local edits", async () => {
		const snapshot = await service.create(request());
		const file = snapshot.files.find((entry) => entry.path === "renamed.ts");
		if (!file) throw new Error("missing rename");
		fixture.git("update-ref", "refs/heads/change", fixture.base);
		fixture.write("renamed.ts", "uncommitted unrelated content");
		for (const side of ["base", "head"] as const) {
			const result = await service.read({
				workspaceId: "ws",
				snapshotId: snapshot.id,
				fileId: file.id,
				side,
			});
			expect(result.kind).toBe("text");
			if (result.kind === "text") expect(result.content).toContain("export const first = 1;");
		}
	});

	test("distinguishes deleted/added absence from an actual empty blob", async () => {
		expect(await read("deleted.txt", "head")).toMatchObject({ kind: "absent" });
		expect(await read("deleted.txt", "base")).toMatchObject({
			kind: "text",
			content: "base only\n",
		});
		expect(await read("empty.txt", "head")).toMatchObject({ kind: "text", content: "" });
		expect(await read("empty.txt", "base")).toMatchObject({ kind: "absent" });
	});

	test("includes more than 100 files and safely round-trips unusual paths", async () => {
		fixture.git("checkout", "change");
		for (let i = 0; i < 105; i++) fixture.write(`many/${i}.ts`, `export const n = ${i};`);
		fixture.write("tabs\tand\nnewlines ü.ts", "special path\n");
		const snapshot = await service.create({ ...request(), headOid: fixture.commit() });
		expect(snapshot.files).toHaveLength(110);
		const file = snapshot.files.find((entry) => entry.path === "tabs\tand\nnewlines ü.ts");
		if (!file) throw new Error("missing unusual path");
		expect(
			await service.read({
				workspaceId: "ws",
				snapshotId: snapshot.id,
				fileId: file.id,
				side: "head",
			})
		).toMatchObject({ kind: "text", content: "special path\n" });
	});

	test("returns metadata-only reasons for symlinks, gitlinks, binary, large and LFS blobs", async () => {
		fixture.git("checkout", "change");
		const outside = join(fixture.directory, "outside.txt");
		writeFileSync(outside, "synthetic-private-sentinel");
		symlinkSync(outside, join(fixture.root, "link"));
		fixture.write("binary.dat", Buffer.from([0, 1, 2]));
		fixture.write("encoding.dat", Buffer.from([255, 254, 253]));
		fixture.write("large.txt", "x".repeat(1024 * 1024 + 1));
		fixture.write(
			"pointer",
			`version https://git-lfs.github.com/spec/v1\noid sha256:${"a".repeat(64)}\nsize 123\n`
		);
		fixture.git("add", "--all");
		fixture.git("update-index", "--add", "--cacheinfo", `160000,${fixture.base},module`);
		fixture.git("-c", "commit.gpgsign=false", "commit", "-m", "gitlink fixture");
		const snapshot = await service.create({
			...request(),
			headOid: fixture.git("rev-parse", "HEAD"),
		});
		for (const [path, reason] of [
			["link", "symlink"],
			["module", "submodule"],
			["binary.dat", "binary"],
			["encoding.dat", "non-utf8"],
			["large.txt", "too-large"],
			["pointer", "lfs-pointer"],
		]) {
			const file = snapshot.files.find((entry) => entry.path === path);
			if (!file) throw new Error(`missing ${path}`);
			expect(
				await service.read({
					workspaceId: "ws",
					snapshotId: snapshot.id,
					fileId: file.id,
					side: "head",
				})
			).toMatchObject({ kind: "omitted", reason });
		}
	});

	test("rejects branch names, revision expressions and missing commit objects", async () => {
		for (const headOid of ["change", "HEAD~1", "--help", "a".repeat(40)]) {
			await expect(service.create({ ...request(), headOid })).rejects.toMatchObject({
				code: headOid.length === 40 ? "OBJECT_UNAVAILABLE" : "INVALID_REVISION",
			});
		}
		const blob = fixture.git("rev-parse", `${fixture.head}:new.txt`);
		await expect(service.create({ ...request(), headOid: blob })).rejects.toMatchObject({
			code: "INVALID_REVISION",
		});
	});

	test("missing cached blob is unavailable, never represented as empty content", async () => {
		const snapshot = await service.create(request());
		const file = snapshot.files.find((entry) => entry.path === "new.txt");
		if (!file?.head) throw new Error("missing new file");
		rmSync(
			join(fixture.root, ".git", "objects", file.head.oid.slice(0, 2), file.head.oid.slice(2))
		);
		expect(
			await service.read({
				workspaceId: "ws",
				snapshotId: snapshot.id,
				fileId: file.id,
				side: "head",
			})
		).toMatchObject({ kind: "unavailable", reason: "object-unavailable" });
	});

	test("rejects missing merge bases and shallow history", async () => {
		fixture.git("checkout", "--orphan", "unrelated");
		const unrelated = fixture.commit();
		await expect(service.create({ ...request(), headOid: unrelated })).rejects.toMatchObject({
			code: "MERGE_BASE_UNAVAILABLE",
		});
		writeFileSync(join(fixture.root, ".git", "shallow"), `${fixture.head}\n`);
		await expect(service.create(request())).rejects.toMatchObject({ code: "SHALLOW_HISTORY" });
	});

	test("rejects multiple merge bases rather than selecting an arbitrary one", async () => {
		const tree = fixture.git("rev-parse", `${fixture.head}^{tree}`);
		const left = fixture.git(
			"commit-tree",
			tree,
			"-p",
			fixture.head,
			"-p",
			fixture.target,
			"-m",
			"left"
		);
		const right = fixture.git(
			"commit-tree",
			tree,
			"-p",
			fixture.target,
			"-p",
			fixture.head,
			"-m",
			"right"
		);
		await expect(
			service.create({ ...request(), targetTipOid: left, headOid: right })
		).rejects.toMatchObject({ code: "AMBIGUOUS_MERGE_BASE" });
	});

	test("does not execute repository diff or textconv helpers", async () => {
		fixture.git("checkout", "change");
		const marker = join(fixture.directory, "helper-ran");
		fixture.write(".gitattributes", "*.txt diff=unsafe\n");
		fixture.git("config", "diff.unsafe.command", `touch '${marker}'`);
		fixture.git("config", "diff.unsafe.textconv", `touch '${marker}'`);
		const snapshot = await service.create({ ...request(), headOid: fixture.commit() });
		const file = snapshot.files.find((entry) => entry.path === "new.txt");
		if (!file) throw new Error("missing file");
		await service.read({
			workspaceId: "ws",
			snapshotId: snapshot.id,
			fileId: file.id,
			side: "head",
		});
		expect(existsSync(marker)).toBe(false);
	});

	test("enforces snapshot ownership, root binding and file membership", async () => {
		let root = fixture.root;
		service = new ReviewSnapshotService({ resolveRoot: async () => root });
		const snapshot = await service.create(request());
		const input = {
			workspaceId: "ws",
			snapshotId: snapshot.id,
			fileId: snapshot.files[0]?.id ?? "",
			side: "head" as const,
		};
		await expect(service.read({ ...input, workspaceId: "other" })).rejects.toMatchObject({
			code: "SNAPSHOT_UNAVAILABLE",
		});
		await expect(service.read({ ...input, fileId: "../../outside" })).rejects.toMatchObject({
			code: "FILE_UNAVAILABLE",
		});
		root = fixture.directory;
		await expect(service.read(input)).rejects.toMatchObject({ code: "WORKSPACE_CHANGED" });
	});

	test("bounds the cache and manifest without silently truncating", async () => {
		service = new ReviewSnapshotService({ resolveRoot: async () => fixture.root, maxSnapshots: 1 });
		const first = await service.create(request());
		const empty = await service.create({ ...request(), headOid: fixture.base });
		expect(empty.files).toEqual([]);
		await expect(
			service.read({
				workspaceId: "ws",
				snapshotId: first.id,
				fileId: first.files[0]?.id ?? "",
				side: "base",
			})
		).rejects.toMatchObject({ code: "SNAPSHOT_UNAVAILABLE" });
		service = new ReviewSnapshotService({ resolveRoot: async () => fixture.root, maxFiles: 2 });
		await expect(service.create(request())).rejects.toMatchObject({ code: "MANIFEST_LIMIT" });
	});

	test("does not expose mutable cached state", async () => {
		const first = await service.create(request());
		first.files.splice(0);
		expect((await service.create(request())).files).toHaveLength(4);
	});

	test("cancelled reads and snapshot creation do not return or cache results", async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(service.create(request(), controller.signal)).rejects.toMatchObject({
			code: "CANCELLED",
		});
		const snapshot = await service.create(request());
		await expect(
			service.read(
				{
					workspaceId: "ws",
					snapshotId: snapshot.id,
					fileId: snapshot.files[0]?.id ?? "",
					side: "base",
				},
				controller.signal
			)
		).rejects.toMatchObject({ code: "CANCELLED" });
	});
});

test("a delayed read cannot resurrect an evicted cache entry", async () => {
	let release: (() => void) | undefined;
	let holdNext = false;
	service = new ReviewSnapshotService({
		maxSnapshots: 1,
		resolveRoot: async () => {
			if (holdNext) {
				holdNext = false;
				await new Promise<void>((resolve) => {
					release = resolve;
				});
			}
			return fixture.root;
		},
	});
	const snapshot = await service.create(request());
	holdNext = true;
	const pending = service.read({
		workspaceId: "ws",
		snapshotId: snapshot.id,
		fileId: snapshot.files[0]?.id ?? "",
		side: "base",
	});
	try {
		await service.create({ ...request(), headOid: fixture.base });
	} finally {
		release?.();
	}
	await expect(pending).rejects.toMatchObject({ code: "SNAPSHOT_UNAVAILABLE" });
});

test("cancellation releases a waiting root lookup and does not occupy the request budget", async () => {
	const releases: Array<() => void> = [];
	service = new ReviewSnapshotService({
		resolveRoot: async () => {
			await new Promise<void>((resolve) => releases.push(resolve));
			return fixture.root;
		},
	});
	const controller = new AbortController();
	const pending = service.create(request(), controller.signal).then(
		() => "returned",
		(error: { code: string }) => error.code
	);
	controller.abort();
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		const outcome = await Promise.race([
			pending,
			new Promise<string>((resolve) => {
				timer = setTimeout(() => resolve("still waiting"), 100);
			}),
		]);
		expect(outcome).toBe("CANCELLED");
	} finally {
		clearTimeout(timer);
		for (const release of releases) release();
		await pending;
	}
});

test("accepts a registered repository root with trailing whitespace", async () => {
	const movedRoot = `${fixture.root} `;
	renameSync(fixture.root, movedRoot);
	service = new ReviewSnapshotService({ resolveRoot: async () => movedRoot });
	expect((await service.create(request())).files).toHaveLength(4);
});

test("bounds concurrent requests and recovers after completion", async () => {
	const releases: Array<() => void> = [];
	let pause = true;
	service = new ReviewSnapshotService({
		resolveRoot: async () => {
			if (pause) await new Promise<void>((resolve) => releases.push(resolve));
			return fixture.root;
		},
	});
	const first = service.create(request());
	const second = service.create(request());
	try {
		await expect(service.create(request())).rejects.toMatchObject({ code: "BUSY" });
	} finally {
		pause = false;
		for (const release of releases) release();
	}
	await Promise.all([first, second]);
	expect((await service.create(request())).files).toHaveLength(4);
});

test("cancels a live Git object-reader subprocess", async () => {
	const controller = new AbortController();
	const pending = readGit(fixture.root, ["cat-file", "--batch"], controller.signal);
	const timer = setTimeout(() => controller.abort(), 50);
	try {
		await expect(pending).rejects.toMatchObject({ reason: "cancelled" });
	} finally {
		clearTimeout(timer);
	}
});

test("does not inherit Git directory overrides or replacement objects", async () => {
	const oldDir = process.env["GIT_DIR"];
	process.env["GIT_DIR"] = join(fixture.directory, "not-a-repository");
	try {
		expect((await service.create(request())).headOid).toBe(fixture.head);
	} finally {
		if (oldDir === undefined) {
			// biome-ignore lint/performance/noDelete: process.env stringifies undefined; restore absence.
			delete process.env["GIT_DIR"];
		} else process.env["GIT_DIR"] = oldDir;
	}
	fixture.git("replace", fixture.head, fixture.base);
	service = new ReviewSnapshotService({ resolveRoot: async () => fixture.root });
	expect((await service.create(request())).files).toHaveLength(4);
});

test("preserves the exact text including a UTF-8 BOM and CRLF", async () => {
	fixture.git("checkout", "change");
	const content = "\uFEFFexport const value = 1;\r\n";
	fixture.write("bom.ts", content);
	const snapshot = await service.create({ ...request(), headOid: fixture.commit() });
	const file = snapshot.files.find((entry) => entry.path === "bom.ts");
	if (!file) throw new Error("missing BOM file");
	expect(
		await service.read({
			workspaceId: "ws",
			snapshotId: snapshot.id,
			fileId: file.id,
			side: "head",
		})
	).toMatchObject({ kind: "text", content });
});
