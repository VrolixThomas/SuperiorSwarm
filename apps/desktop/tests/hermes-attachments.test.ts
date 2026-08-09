import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	HERMES_GENERAL_ATTACHMENT_MAX_BYTES,
	HERMES_IMAGE_ATTACHMENT_MAX_BYTES,
	HERMES_MAX_ATTACHMENTS,
	HermesAttachmentStore,
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
	test("validates selected regular files and exposes only opaque safe metadata", async () => {
		const directory = await temporaryDirectory();
		const imagePath = join(directory, "screen.png");
		const notesPath = join(directory, "release notes.txt");
		await writeFile(imagePath, Buffer.from("png"));
		await writeFile(notesPath, Buffer.from("notes"));
		let nextId = 0;
		const store = new HermesAttachmentStore({ idFactory: () => `opaque-${++nextId}` });

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
		expect((await store.resolve(["opaque-1", "opaque-2"])).map((item) => item.path)).toEqual([
			imagePath,
			notesPath,
		]);
	});

	test("rejects missing paths, directories, too many files, and bounded oversized files", async () => {
		const directory = await temporaryDirectory();
		const imagePath = join(directory, "huge.png");
		const filePath = join(directory, "huge.bin");
		await writeFile(imagePath, "x");
		await writeFile(filePath, "x");
		await truncate(imagePath, HERMES_IMAGE_ATTACHMENT_MAX_BYTES + 1);
		await truncate(filePath, HERMES_GENERAL_ATTACHMENT_MAX_BYTES + 1);
		const store = new HermesAttachmentStore();

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
		});
		await store.registerPaths([filePath]);

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
		expect(store.size).toBe(0);

		now = 2_000;
		await store.registerPaths([filePath]);
		store.release(["opaque-retry"]);
		expect(store.size).toBe(0);
	});

	test("rejects duplicate handles and files changed after selection", async () => {
		const directory = await temporaryDirectory();
		const filePath = join(directory, "mutable.txt");
		await writeFile(filePath, "first");
		const store = new HermesAttachmentStore({ idFactory: () => "opaque-mutable" });
		await store.registerPaths([filePath]);

		await expect(store.resolve(["opaque-mutable", "opaque-mutable"])).rejects.toThrow(
			"Duplicate attachment"
		);
		await writeFile(filePath, "changed-size");
		await expect(store.resolve(["opaque-mutable"])).rejects.toThrow("changed after selection");
	});
});
