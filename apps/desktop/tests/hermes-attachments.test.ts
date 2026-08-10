import { afterEach, describe, expect, test } from "bun:test";
import {
	chmod,
	lstat,
	mkdtemp,
	readFile,
	rm,
	symlink,
	truncate,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	HERMES_ATTACHMENT_IPC_MAX_BYTES,
	HERMES_ATTACHMENT_UPLOAD_CHUNK_MAX_BYTES,
	HERMES_GENERAL_ATTACHMENT_MAX_BYTES,
	HERMES_IMAGE_ATTACHMENT_MAX_BYTES,
	HERMES_MAX_ATTACHMENTS,
	HermesAttachmentStore,
	HermesRendererAttachmentUploadManager,
} from "../src/main/hermes/hermes-attachments";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "superiorswarm-hermes-attachment-test-"));
	temporaryDirectories.push(directory);
	return directory;
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
	);
});

describe("Hermes attachment store", () => {
	test("registers pasted and dropped renderer bytes without accepting a renderer path", async () => {
		const directory = await temporaryDirectory();
		let nextId = 0;
		const store = new HermesAttachmentStore({
			idFactory: () => `renderer-${++nextId}`,
			stagingParentDirectory: directory,
		});

		const selected = await store.registerBytes([
			{
				name: "pasted.png",
				size: 4,
				mimeType: "image/png",
				bytes: new Uint8Array([1, 2, 3, 4]),
			},
			{
				name: "dropped.txt",
				size: 5,
				mimeType: "text/plain",
				bytes: new TextEncoder().encode("notes"),
			},
		]);

		expect(selected).toEqual([
			expect.objectContaining({
				handle: "renderer-1",
				name: "pasted.png",
				kind: "image",
				mimeType: "image/png",
				size: 4,
			}),
			expect.objectContaining({
				handle: "renderer-2",
				name: "dropped.txt",
				kind: "file",
				mimeType: "text/plain",
				size: 5,
			}),
		]);
		expect(JSON.stringify(selected)).not.toContain("path");
		expect(await store.readBytes("renderer-1")).toEqual(Buffer.from([1, 2, 3, 4]));
		expect(await store.readBytes("renderer-2")).toEqual(Buffer.from("notes"));
	});

	test("rejects unsafe renderer metadata and aggregate IPC payloads before staging bytes", async () => {
		const directory = await temporaryDirectory();
		const store = new HermesAttachmentStore({ stagingParentDirectory: directory });
		const byte = new Uint8Array([1]);

		await expect(
			store.registerBytes([{ name: "../secret.txt", size: 1, mimeType: "text/plain", bytes: byte }])
		).rejects.toThrow("safe file name");
		await expect(
			store.registerBytes([{ name: "photo.png", size: 1, mimeType: "text/plain", bytes: byte }])
		).rejects.toThrow("MIME type");
		await expect(
			store.registerBytes([{ name: "notes.txt", size: 2, mimeType: "text/plain", bytes: byte }])
		).rejects.toThrow("size does not match");
		await expect(
			store.registerBytes(
				Array.from({ length: HERMES_MAX_ATTACHMENTS + 1 }, (_, index) => ({
					name: `file-${index}.txt`,
					size: 1,
					mimeType: "text/plain",
					bytes: byte,
				}))
			)
		).rejects.toThrow(`up to ${HERMES_MAX_ATTACHMENTS}`);
		await expect(
			store.registerBytes([
				{
					name: "aggregate.pdf",
					size: HERMES_ATTACHMENT_IPC_MAX_BYTES + 1,
					mimeType: "application/pdf",
					bytes: byte,
				},
			])
		).rejects.toThrow("IPC payload");
		expect(store.size).toBe(0);
	});

	test("bounds every renderer upload frame before staging and cleans abandoned main-issued uploads", async () => {
		const directory = await temporaryDirectory();
		let nextId = 0;
		const store = new HermesAttachmentStore({
			idFactory: () => `attachment-${++nextId}`,
			stagingParentDirectory: directory,
		});
		const uploads = new HermesRendererAttachmentUploadManager(store, {
			idFactory: () => `upload-${++nextId}`,
			stagingParentDirectory: directory,
		});
		const started = uploads.begin("renderer-1", [
			{ name: "bounded.txt", size: 4, mimeType: "text/plain" },
		]);
		const fileId = started.files[0]?.fileId ?? "";

		await expect(
			uploads.append("renderer-1", {
				uploadId: started.uploadId,
				fileId,
				offset: 0,
				bytes: new Uint8Array(HERMES_ATTACHMENT_UPLOAD_CHUNK_MAX_BYTES + 1),
			})
		).rejects.toThrow("upload chunk");
		expect(uploads.activeUploads).toBe(1);

		await uploads.append("renderer-1", {
			uploadId: started.uploadId,
			fileId,
			offset: 0,
			bytes: new TextEncoder().encode("safe"),
		});
		await expect(uploads.finish("renderer-2", started.uploadId)).rejects.toThrow("unavailable");
		await expect(uploads.finish("renderer-1", started.uploadId)).resolves.toEqual([
			expect.objectContaining({ name: "bounded.txt", size: 4 }),
		]);
		expect(uploads.activeUploads).toBe(0);

		const abandoned = uploads.begin("renderer-1", [
			{ name: "abandoned.txt", size: 1, mimeType: "text/plain" },
		]);
		expect(abandoned.uploadId).toBeTruthy();
		expect(uploads.cancelOwner("renderer-1")).toBe(1);
		expect(uploads.activeUploads).toBe(0);
		store.clear();
	});

	test("keeps renderer bytes off generic tRPC and rejects oversized frames before main IPC", async () => {
		const routerSource = await readFile(
			join(import.meta.dir, "../src/main/trpc/routers/hermes.ts"),
			"utf8"
		);
		const preloadSource = await readFile(join(import.meta.dir, "../src/preload/index.ts"), "utf8");
		expect(routerSource).not.toContain("registerAttachments");
		expect(preloadSource).toContain("assertBoundedTrpcInput(opts)");
		expect(preloadSource).toContain("Binary data is not allowed in generic IPC requests");
		const frameGuard = preloadSource.indexOf(
			"input.bytes.byteLength > HERMES_ATTACHMENT_UPLOAD_CHUNK_MAX_BYTES"
		);
		const frameInvoke = preloadSource.indexOf(
			'ipcRenderer.invoke("hermes-attachments:append", input)'
		);
		expect(frameGuard).toBeGreaterThan(-1);
		expect(frameInvoke).toBeGreaterThan(frameGuard);
	});

	test("enforces aggregate bytes across attachment handles registered in separate batches", async () => {
		const directory = await temporaryDirectory();
		const store = new HermesAttachmentStore({ stagingParentDirectory: directory });
		const stagedPath = join(directory, "aggregate.pdf");
		await writeFile(stagedPath, "x");
		const internal = Reflect.get(store, "attachments") as Map<string, unknown>;
		for (const [handle, size] of [
			["batch-1", HERMES_ATTACHMENT_IPC_MAX_BYTES],
			["batch-2", 1],
		] as const) {
			internal.set(handle, {
				handle,
				path: stagedPath,
				name: `${handle}.pdf`,
				size,
				mimeType: "application/pdf",
				kind: "pdf",
				expiresAt: Date.now() + 60_000,
				maxBytes: HERMES_ATTACHMENT_IPC_MAX_BYTES,
				attachedByRuntime: new Map(),
				owners: new Set(),
			});
		}

		await expect(store.claim(["batch-1", "batch-2"], "composed-message")).rejects.toThrow(
			"must total 64 MiB"
		);
		expect(store.size).toBe(2);
		store.clear();
	});

	test("validates selected regular files and exposes only opaque safe metadata", async () => {
		const directory = await temporaryDirectory();
		const imagePath = join(directory, "screen.png");
		const notesPath = join(directory, "release notes.txt");
		await writeFile(imagePath, Buffer.from("png"));
		await writeFile(notesPath, Buffer.from("notes"));
		let nextId = 0;
		const store = new HermesAttachmentStore({
			idFactory: () => `opaque-${++nextId}`,
			stagingParentDirectory: directory,
		});

		const selected = await store.registerPaths([imagePath, notesPath]);

		expect(selected).toEqual([
			expect.objectContaining({
				handle: "opaque-1",
				name: "screen.png",
				size: 3,
				mimeType: "image/png",
				kind: "image",
			}),
			expect.objectContaining({
				handle: "opaque-2",
				name: "release notes.txt",
				size: 5,
				mimeType: "text/plain",
				kind: "file",
			}),
		]);
		expect(JSON.stringify(selected)).not.toContain(directory);
		const resolved = await store.resolve(["opaque-1", "opaque-2"]);
		expect(resolved.map((item) => item.path)).not.toContain(imagePath);
		expect(resolved.map((item) => item.path)).not.toContain(notesPath);
		expect(await readFile(resolved[0]?.path ?? "", "utf8")).toBe("png");
		expect(await readFile(resolved[1]?.path ?? "", "utf8")).toBe("notes");
		expect((await lstat(resolved[0]?.path ?? "")).mode & 0o777).toBe(0o400);
		expect((await lstat(join(resolved[0]?.path ?? "", ".."))).mode & 0o777).toBe(0o700);
	});

	test("rejects missing paths, directories, too many files, and bounded oversized files", async () => {
		const directory = await temporaryDirectory();
		const imagePath = join(directory, "huge.png");
		const filePath = join(directory, "huge.bin");
		await writeFile(imagePath, "x");
		await writeFile(filePath, "x");
		await truncate(imagePath, HERMES_IMAGE_ATTACHMENT_MAX_BYTES + 1);
		await truncate(filePath, HERMES_GENERAL_ATTACHMENT_MAX_BYTES + 1);
		const store = new HermesAttachmentStore({ stagingParentDirectory: directory });

		await expect(store.registerPaths([join(directory, "missing.txt")])).rejects.toThrow(
			"no longer exists"
		);
		await expect(store.registerPaths([directory])).rejects.toThrow("regular file");
		await expect(
			store.registerPaths(Array(HERMES_MAX_ATTACHMENTS + 1).fill(imagePath))
		).rejects.toThrow(`up to ${HERMES_MAX_ATTACHMENTS}`);
		await expect(store.registerPaths([imagePath])).rejects.toThrow(
			"Images must be 16 MiB or smaller"
		);
		await expect(store.registerPaths([filePath])).rejects.toThrow(
			"Files must be 32 MiB or smaller"
		);
		expect(store.size).toBe(0);
	});

	test("retains handles for retry, caches per-runtime attach results, and cleans removal or expiry", async () => {
		const directory = await temporaryDirectory();
		const filePath = join(directory, "retry.txt");
		await writeFile(filePath, "retry");
		let now = 1_000;
		const store = new HermesAttachmentStore({
			idFactory: () => "opaque-retry",
			now: () => now,
			ttlMs: 100,
			stagingParentDirectory: directory,
		});
		await store.registerPaths([filePath]);
		const expiredStagedPath = (await store.resolve(["opaque-retry"]))[0]?.path ?? "";

		store.markAttached("opaque-retry", "runtime-1", {
			contextText: "@file:attachments/retry.txt",
			refText: "@file:attachments/retry.txt",
		});
		expect(store.attachedResult("opaque-retry", "runtime-1")).toEqual({
			contextText: "@file:attachments/retry.txt",
			refText: "@file:attachments/retry.txt",
		});
		expect(store.attachedResult("opaque-retry", "runtime-2")).toBeNull();

		now = 1_101;
		expect(store.sweepExpired()).toBe(1);
		await expect(store.resolve(["opaque-retry"])).rejects.toThrow("expired");
		expect(await Bun.file(expiredStagedPath).exists()).toBe(false);
		expect(store.size).toBe(0);

		now = 2_000;
		await store.registerPaths([filePath]);
		const releasedStagedPath = (await store.resolve(["opaque-retry"]))[0]?.path ?? "";
		store.release(["opaque-retry"]);
		expect(await Bun.file(releasedStagedPath).exists()).toBe(false);
		expect(store.size).toBe(0);

		now = 3_000;
		await store.registerPaths([filePath]);
		const shutdownStagedPath = (await store.resolve(["opaque-retry"]))[0]?.path ?? "";
		store.clear();
		expect(await Bun.file(shutdownStagedPath).exists()).toBe(false);
	});

	test("claims queue ownership before renderer cleanup can release a staged handle", async () => {
		const directory = await temporaryDirectory();
		const filePath = join(directory, "refresh.txt");
		await writeFile(filePath, "survives refresh");
		const store = new HermesAttachmentStore({
			idFactory: () => "opaque-refresh",
			stagingParentDirectory: directory,
		});
		await store.registerPaths([filePath]);

		const claiming = store.claim(["opaque-refresh"], "queued-follow-up");
		store.release(["opaque-refresh"]);
		await expect(claiming).resolves.toEqual([
			expect.objectContaining({ handle: "opaque-refresh", name: "refresh.txt" }),
		]);
		expect(store.size).toBe(1);

		store.releaseClaim(["opaque-refresh"], "queued-follow-up");
		expect(store.size).toBe(0);
	});

	test("keeps an immutable private snapshot when the selected pathname is swapped", async () => {
		const directory = await temporaryDirectory();
		const filePath = join(directory, "mutable.txt");
		await writeFile(filePath, "first");
		const store = new HermesAttachmentStore({
			idFactory: () => "opaque-mutable",
			stagingParentDirectory: directory,
		});
		await store.registerPaths([filePath]);

		await expect(store.resolve(["opaque-mutable", "opaque-mutable"])).rejects.toThrow(
			"Duplicate attachment"
		);
		const replacementPath = join(directory, "replacement.txt");
		await writeFile(replacementPath, "changed-size");
		await rm(filePath);
		await symlink(replacementPath, filePath);
		const [resolved] = await store.resolve(["opaque-mutable"]);
		expect(resolved?.path).not.toBe(filePath);
		expect(await readFile(resolved?.path ?? "", "utf8")).toBe("first");
	});

	test("does not follow symlinks and revalidates a staged file before use", async () => {
		const directory = await temporaryDirectory();
		const targetPath = join(directory, "target.txt");
		const linkPath = join(directory, "linked.txt");
		await writeFile(targetPath, "target");
		await symlink(targetPath, linkPath);
		const store = new HermesAttachmentStore({
			idFactory: () => "opaque-safe",
			stagingParentDirectory: directory,
		});

		await expect(store.registerPaths([linkPath])).rejects.toThrow("regular file");
		expect(store.size).toBe(0);

		const [selected] = await store.registerPaths([targetPath]);
		const stagedPath = (await store.resolve([selected?.handle ?? ""]))[0]?.path ?? "";
		await chmod(stagedPath, 0o600);
		await truncate(stagedPath, HERMES_GENERAL_ATTACHMENT_MAX_BYTES + 1);
		await expect(store.resolve([selected?.handle ?? ""])).rejects.toThrow("select it again");
	});
});
