import { randomUUID } from "node:crypto";
import { constants, chmodSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import type {
	HermesAttachmentKind,
	HermesAttachmentMetadata,
	HermesRendererAttachmentUpload,
	HermesRendererAttachmentUploadMetadata,
	HermesRendererAttachmentUploadStart,
} from "../../shared/hermes";
import {
	HERMES_ATTACHMENT_CONTEXT_END,
	HERMES_ATTACHMENT_CONTEXT_START,
	HERMES_ATTACHMENT_IPC_MAX_BYTES,
	HERMES_ATTACHMENT_UPLOAD_CHUNK_MAX_BYTES,
	HERMES_GENERAL_ATTACHMENT_MAX_BYTES,
	HERMES_IMAGE_ATTACHMENT_MAX_BYTES,
	HERMES_MAX_ATTACHMENTS,
	HERMES_PDF_ATTACHMENT_MAX_BYTES,
} from "../../shared/hermes";

export {
	HERMES_ATTACHMENT_IPC_MAX_BYTES,
	HERMES_ATTACHMENT_UPLOAD_CHUNK_MAX_BYTES,
	HERMES_GENERAL_ATTACHMENT_MAX_BYTES,
	HERMES_IMAGE_ATTACHMENT_MAX_BYTES,
	HERMES_MAX_ATTACHMENTS,
	HERMES_PDF_ATTACHMENT_MAX_BYTES,
} from "../../shared/hermes";
export const HERMES_ATTACHMENT_TTL_MS = 30 * 60 * 1_000;
const IMAGE_MIME_TYPES: Record<string, string> = {
	".avif": "image/avif",
	".bmp": "image/bmp",
	".gif": "image/gif",
	".heic": "image/heic",
	".heif": "image/heif",
	".jpeg": "image/jpeg",
	".jpg": "image/jpeg",
	".png": "image/png",
	".tif": "image/tiff",
	".tiff": "image/tiff",
	".webp": "image/webp",
};

const GENERAL_MIME_TYPES: Record<string, string> = {
	".csv": "text/csv",
	".html": "text/html",
	".json": "application/json",
	".md": "text/markdown",
	".toml": "application/toml",
	".tsv": "text/tab-separated-values",
	".txt": "text/plain",
	".xml": "application/xml",
	".yaml": "application/yaml",
	".yml": "application/yaml",
	".zip": "application/zip",
};

export interface HermesResolvedAttachment extends HermesAttachmentMetadata {
	path: string;
}

export interface HermesAttachedResult {
	contextText: string;
	refText: string | null;
}

export interface HermesPromptAttachment {
	kind: HermesAttachmentKind;
	name: string;
	refText: string | null;
}

export function buildHermesAttachmentPromptText(
	text: string,
	attachments: HermesPromptAttachment[]
): string {
	if (attachments.length === 0) return text;
	const rows = attachments.map((attachment) =>
		JSON.stringify({
			kind: attachment.kind,
			name: attachment.name,
			...(attachment.refText ? { ref: attachment.refText } : {}),
		})
	);
	const visibleText = text.trim() || "Review the attached files.";
	return [
		HERMES_ATTACHMENT_CONTEXT_START,
		...rows,
		HERMES_ATTACHMENT_CONTEXT_END,
		"",
		visibleText,
	].join("\n");
}

interface StoredAttachment extends HermesResolvedAttachment {
	maxBytes: number;
	attachedByRuntime: Map<string, HermesAttachedResult>;
	owners: Set<string>;
}

export interface HermesAttachmentStoreOptions {
	idFactory?: () => string;
	now?: () => number;
	ttlMs?: number;
	stagingParentDirectory?: string;
}

const COPY_BUFFER_BYTES = 64 * 1024;

function safeFileName(path: string): string {
	const filtered = Array.from(basename(path).normalize("NFC"))
		.filter((character) => {
			const code = character.charCodeAt(0);
			return code >= 32 && code !== 127;
		})
		.join("")
		.trim();
	return filtered.slice(0, 255) || "attachment";
}

function rendererFileName(value: string): string {
	if (value.length > 255) throw new Error("Attachments must have a safe file name");
	const normalized = value.normalize("NFC");
	if (
		value !== normalized ||
		value !== value.trim() ||
		basename(value) !== value ||
		value.includes("/") ||
		value.includes("\\") ||
		safeFileName(value) !== value
	) {
		throw new Error("Attachments must have a safe file name");
	}
	return value;
}

function attachmentType(path: string): {
	kind: HermesAttachmentKind;
	mimeType: string;
	maxBytes: number;
	tooLargeMessage: string;
} {
	const extension = extname(path).toLocaleLowerCase();
	const imageMimeType = IMAGE_MIME_TYPES[extension];
	if (imageMimeType) {
		return {
			kind: "image",
			mimeType: imageMimeType,
			maxBytes: HERMES_IMAGE_ATTACHMENT_MAX_BYTES,
			tooLargeMessage: "Images must be 16 MiB or smaller",
		};
	}
	if (extension === ".pdf") {
		return {
			kind: "pdf",
			mimeType: "application/pdf",
			maxBytes: HERMES_PDF_ATTACHMENT_MAX_BYTES,
			tooLargeMessage: "PDFs must be 50 MiB or smaller",
		};
	}
	return {
		kind: "file",
		mimeType: GENERAL_MIME_TYPES[extension] ?? "application/octet-stream",
		maxBytes: HERMES_GENERAL_ATTACHMENT_MAX_BYTES,
		tooLargeMessage: "Files must be 32 MiB or smaller",
	};
}

function validateRendererAttachmentMetadata(upload: HermesRendererAttachmentUploadMetadata): {
	name: string;
	size: number;
	mimeType: string;
	type: ReturnType<typeof attachmentType>;
} {
	const name = rendererFileName(upload.name);
	if (!Number.isSafeInteger(upload.size) || upload.size < 0) {
		throw new Error("Attachment size is invalid");
	}
	const type = attachmentType(name);
	if (upload.mimeType.length > 255) throw new Error(`“${name}” has an invalid MIME type`);
	const reportedMimeType = upload.mimeType.trim().toLocaleLowerCase();
	if (
		(reportedMimeType &&
			!/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u.test(reportedMimeType)) ||
		(type.kind !== "file" &&
			reportedMimeType !== "" &&
			reportedMimeType !== type.mimeType &&
			reportedMimeType !== "application/octet-stream")
	) {
		throw new Error(`“${name}” has an invalid MIME type`);
	}
	if (upload.size > type.maxBytes) throw new Error(`${type.tooLargeMessage}: “${name}”`);
	return { name, size: upload.size, mimeType: type.mimeType, type };
}

export class HermesAttachmentStore {
	private readonly attachments = new Map<string, StoredAttachment>();
	private readonly expiredHandles = new Set<string>();
	private readonly idFactory: () => string;
	private readonly now: () => number;
	private readonly ttlMs: number;
	private readonly stagingParentDirectory: string;
	private stagingDirectory: string | null = null;

	constructor(options: HermesAttachmentStoreOptions = {}) {
		this.idFactory = options.idFactory ?? randomUUID;
		this.now = options.now ?? Date.now;
		this.ttlMs = options.ttlMs ?? HERMES_ATTACHMENT_TTL_MS;
		this.stagingParentDirectory = options.stagingParentDirectory ?? tmpdir();
	}

	get size(): number {
		return this.attachments.size;
	}

	async registerPaths(paths: string[]): Promise<HermesAttachmentMetadata[]> {
		this.sweepExpired();
		if (paths.length > HERMES_MAX_ATTACHMENTS) {
			throw new Error(`Select up to ${HERMES_MAX_ATTACHMENTS} attachments at a time`);
		}
		const pending: StoredAttachment[] = [];
		const reservedHandles = new Set<string>();
		try {
			for (const sourcePath of paths) {
				const name = safeFileName(sourcePath);
				const type = attachmentType(sourcePath);
				let handle = this.idFactory();
				while (this.attachments.has(handle) || reservedHandles.has(handle))
					handle = this.idFactory();
				reservedHandles.add(handle);
				const staged = await this.stageFile(sourcePath, name, type.maxBytes, type.tooLargeMessage);
				pending.push({
					handle,
					path: staged.path,
					name,
					size: staged.size,
					mimeType: type.mimeType,
					kind: type.kind,
					expiresAt: 0,
					maxBytes: type.maxBytes,
					attachedByRuntime: new Map(),
					owners: new Set(),
				});
			}
		} catch (error) {
			for (const attachment of pending) this.removeStagedFile(attachment.path);
			this.removeEmptyStagingDirectory();
			throw error;
		}

		const expiresAt = this.now() + this.ttlMs;
		for (const attachment of pending) {
			attachment.expiresAt = expiresAt;
			this.expiredHandles.delete(attachment.handle);
			this.attachments.set(attachment.handle, attachment);
		}
		return pending.map(this.metadata);
	}

	async registerBytes(
		uploads: HermesRendererAttachmentUpload[]
	): Promise<HermesAttachmentMetadata[]> {
		this.sweepExpired();
		if (uploads.length > HERMES_MAX_ATTACHMENTS) {
			throw new Error(`Attach up to ${HERMES_MAX_ATTACHMENTS} files at a time`);
		}
		let aggregateBytes = 0;
		for (const upload of uploads) {
			if (!(upload.bytes instanceof Uint8Array)) {
				throw new Error("Attachment bytes must be a Uint8Array");
			}
			if (!Number.isSafeInteger(upload.size) || upload.size < 0) {
				throw new Error("Attachment size is invalid");
			}
			aggregateBytes += upload.size;
			if (aggregateBytes > HERMES_ATTACHMENT_IPC_MAX_BYTES) {
				throw new Error("Attachment IPC payloads must total 64 MiB or smaller");
			}
		}
		const aggregateActualBytes = uploads.reduce(
			(total, upload) => total + upload.bytes.byteLength,
			0
		);
		if (aggregateActualBytes > HERMES_ATTACHMENT_IPC_MAX_BYTES) {
			throw new Error("Attachment IPC payloads must total 64 MiB or smaller");
		}

		const pending: StoredAttachment[] = [];
		const reservedHandles = new Set<string>();
		try {
			for (const upload of uploads) {
				const { name, type } = validateRendererAttachmentMetadata(upload);
				if (upload.bytes.byteLength !== upload.size) {
					throw new Error(`“${name}” size does not match its bytes`);
				}
				let handle = this.idFactory();
				while (this.attachments.has(handle) || reservedHandles.has(handle)) {
					handle = this.idFactory();
				}
				reservedHandles.add(handle);
				const stagedPath = await this.stageBytes(upload.bytes, name);
				pending.push({
					handle,
					path: stagedPath,
					name,
					size: upload.size,
					mimeType: type.mimeType,
					kind: type.kind,
					expiresAt: 0,
					maxBytes: type.maxBytes,
					attachedByRuntime: new Map(),
					owners: new Set(),
				});
			}
		} catch (error) {
			for (const attachment of pending) this.removeStagedFile(attachment.path);
			this.removeEmptyStagingDirectory();
			throw error;
		}

		const expiresAt = this.now() + this.ttlMs;
		for (const attachment of pending) {
			attachment.expiresAt = expiresAt;
			this.expiredHandles.delete(attachment.handle);
			this.attachments.set(attachment.handle, attachment);
		}
		return pending.map(this.metadata);
	}

	async resolve(handles: string[]): Promise<HermesResolvedAttachment[]> {
		if (handles.length > HERMES_MAX_ATTACHMENTS) {
			throw new Error(`Submit up to ${HERMES_MAX_ATTACHMENTS} attachments at a time`);
		}
		if (new Set(handles).size !== handles.length) throw new Error("Duplicate attachment handle");
		this.sweepExpired();
		const resolved: HermesResolvedAttachment[] = [];
		for (const handle of handles) {
			const attachment = this.attachments.get(handle);
			if (!attachment) {
				throw new Error(
					this.expiredHandles.has(handle)
						? "An attachment expired. Select it again"
						: "An attachment is unavailable. Select it again"
				);
			}
			try {
				const file = await open(attachment.path, constants.O_RDONLY | constants.O_NOFOLLOW);
				try {
					const info = await file.stat();
					if (
						!info.isFile() ||
						info.size !== attachment.size ||
						info.size > attachment.maxBytes ||
						(info.mode & 0o222) !== 0
					) {
						throw new Error("invalid staged attachment");
					}
				} finally {
					await file.close();
				}
			} catch {
				this.removeAttachment(handle);
				throw new Error(`“${attachment.name}” is unavailable; select it again`);
			}
			resolved.push({ ...this.metadata(attachment), path: attachment.path });
		}
		return resolved;
	}

	async readBytes(handle: string): Promise<Buffer> {
		const [attachment] = await this.resolve([handle]);
		if (!attachment) throw new Error("An attachment is unavailable. Select it again");
		let file: Awaited<ReturnType<typeof open>> | null = null;
		try {
			file = await open(attachment.path, constants.O_RDONLY | constants.O_NOFOLLOW);
			const info = await file.stat();
			if (!info.isFile() || info.size !== attachment.size || (info.mode & 0o222) !== 0) {
				throw new Error("staged attachment changed");
			}
			const bytes = Buffer.alloc(attachment.size);
			let offset = 0;
			while (offset < bytes.length) {
				const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, null);
				if (bytesRead === 0) throw new Error("staged attachment changed");
				offset += bytesRead;
			}
			const overflow = Buffer.alloc(1);
			if ((await file.read(overflow, 0, 1, null)).bytesRead !== 0) {
				throw new Error("staged attachment changed");
			}
			return bytes;
		} catch {
			this.removeAttachment(handle);
			throw new Error(`“${attachment.name}” is unavailable; select it again`);
		} finally {
			await file?.close();
		}
	}

	markAttached(handle: string, runtimeSessionId: string, result: HermesAttachedResult): void {
		const attachment = this.attachments.get(handle);
		if (!attachment) return;
		attachment.attachedByRuntime.set(runtimeSessionId, { ...result });
	}

	attachedResult(handle: string, runtimeSessionId: string): HermesAttachedResult | null {
		const result = this.attachments.get(handle)?.attachedByRuntime.get(runtimeSessionId);
		return result ? { ...result } : null;
	}

	async claim(handles: string[], ownerId: string): Promise<HermesAttachmentMetadata[]> {
		if (!ownerId) throw new Error("Attachment owner is required");
		if (handles.length > HERMES_MAX_ATTACHMENTS) {
			throw new Error(`Submit up to ${HERMES_MAX_ATTACHMENTS} attachments at a time`);
		}
		if (new Set(handles).size !== handles.length) throw new Error("Duplicate attachment handle");
		this.sweepExpired();
		let aggregateBytes = 0;
		for (const handle of handles) {
			const attachment = this.attachments.get(handle);
			if (!attachment) continue;
			aggregateBytes += attachment.size;
			if (aggregateBytes > HERMES_ATTACHMENT_IPC_MAX_BYTES) {
				throw new Error("Attachments in one message must total 64 MiB or smaller");
			}
		}
		const claimed: StoredAttachment[] = [];
		try {
			for (const handle of handles) {
				const attachment = this.attachments.get(handle);
				if (!attachment) {
					throw new Error(
						this.expiredHandles.has(handle)
							? "An attachment expired. Select it again"
							: "An attachment is unavailable. Select it again"
					);
				}
				attachment.owners.add(ownerId);
				claimed.push(attachment);
			}
			const resolved = await this.resolve(handles);
			return resolved.map(({ path: _path, ...metadata }) => metadata);
		} catch (error) {
			for (const attachment of claimed) attachment.owners.delete(ownerId);
			throw error;
		}
	}

	releaseClaim(handles: string[], ownerId: string): void {
		for (const handle of handles) {
			const attachment = this.attachments.get(handle);
			if (!attachment) continue;
			attachment.owners.delete(ownerId);
			if (attachment.owners.size === 0) this.removeAttachment(handle);
		}
	}

	release(handles: string[]): void {
		for (const handle of handles) {
			if ((this.attachments.get(handle)?.owners.size ?? 0) === 0) this.removeAttachment(handle);
		}
	}

	clear(): void {
		for (const attachment of this.attachments.values()) this.removeStagedFile(attachment.path);
		this.attachments.clear();
		this.expiredHandles.clear();
		if (this.stagingDirectory) {
			rmSync(this.stagingDirectory, { force: true, recursive: true });
			this.stagingDirectory = null;
		}
	}

	sweepExpired(): number {
		const now = this.now();
		let removed = 0;
		for (const [handle, attachment] of this.attachments) {
			if (attachment.expiresAt > now || attachment.owners.size > 0) continue;
			this.removeAttachment(handle);
			this.expiredHandles.add(handle);
			removed++;
		}
		this.removeEmptyStagingDirectory();
		return removed;
	}

	private async stageFile(
		sourcePath: string,
		name: string,
		maxBytes: number,
		tooLargeMessage: string
	): Promise<{ path: string; size: number }> {
		let source: Awaited<ReturnType<typeof open>>;
		try {
			source = await open(sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW);
		} catch (error) {
			const code = error instanceof Error && "code" in error ? error.code : null;
			if (code === "ELOOP") throw new Error(`“${name}” is not a regular file`);
			throw new Error(`“${name}” no longer exists`);
		}
		const extension = /^\.[a-z0-9]{1,10}$/i.test(extname(name)) ? extname(name) : "";
		const stagedPath = join(this.ensureStagingDirectory(), `${randomUUID()}${extension}`);
		let destination: Awaited<ReturnType<typeof open>> | null = null;
		let staged = false;
		try {
			const initial = await source.stat();
			if (!initial.isFile()) throw new Error(`“${name}” is not a regular file`);
			if (initial.size > maxBytes) throw new Error(`${tooLargeMessage}: “${name}”`);
			destination = await open(
				stagedPath,
				constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
				0o600
			);
			const buffer = Buffer.allocUnsafe(COPY_BUFFER_BYTES);
			let copied = 0;
			while (true) {
				const remaining = maxBytes - copied + 1;
				const { bytesRead } = await source.read(
					buffer,
					0,
					Math.min(buffer.length, remaining),
					null
				);
				if (bytesRead === 0) break;
				copied += bytesRead;
				if (copied > maxBytes) throw new Error(`${tooLargeMessage}: “${name}”`);
				let written = 0;
				while (written < bytesRead) {
					const result = await destination.write(buffer, written, bytesRead - written, null);
					if (result.bytesWritten === 0) throw new Error(`Could not stage “${name}”`);
					written += result.bytesWritten;
				}
			}
			const final = await source.stat();
			if (
				!final.isFile() ||
				final.size !== initial.size ||
				final.size !== copied ||
				final.mtimeMs !== initial.mtimeMs
			) {
				throw new Error(`“${name}” changed during selection; select it again`);
			}
			await destination.sync();
			await destination.chmod(0o400);
			staged = true;
			return { path: stagedPath, size: copied };
		} finally {
			await destination?.close();
			await source.close();
			if (!staged) this.removeStagedFile(stagedPath);
		}
	}

	private async stageBytes(bytes: Uint8Array, name: string): Promise<string> {
		const extension = /^\.[a-z0-9]{1,10}$/i.test(extname(name)) ? extname(name) : "";
		const stagedPath = join(this.ensureStagingDirectory(), `${randomUUID()}${extension}`);
		let destination: Awaited<ReturnType<typeof open>> | null = null;
		let staged = false;
		try {
			destination = await open(
				stagedPath,
				constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
				0o600
			);
			let written = 0;
			while (written < bytes.byteLength) {
				const result = await destination.write(bytes, written, bytes.byteLength - written, null);
				if (result.bytesWritten === 0) throw new Error(`Could not stage “${name}”`);
				written += result.bytesWritten;
			}
			await destination.sync();
			await destination.chmod(0o400);
			staged = true;
			return stagedPath;
		} finally {
			await destination?.close();
			if (!staged) this.removeStagedFile(stagedPath);
		}
	}

	private ensureStagingDirectory(): string {
		if (this.stagingDirectory) return this.stagingDirectory;
		const directory = mkdtempSync(
			join(this.stagingParentDirectory, "superiorswarm-hermes-attachments-")
		);
		chmodSync(directory, 0o700);
		this.stagingDirectory = directory;
		return directory;
	}

	private removeAttachment(handle: string): void {
		const attachment = this.attachments.get(handle);
		if (attachment) this.removeStagedFile(attachment.path);
		this.attachments.delete(handle);
		this.expiredHandles.delete(handle);
		this.removeEmptyStagingDirectory();
	}

	private removeStagedFile(path: string): void {
		rmSync(path, { force: true });
	}

	private removeEmptyStagingDirectory(): void {
		if (!this.stagingDirectory || this.attachments.size > 0) return;
		try {
			rmSync(this.stagingDirectory, { force: true, recursive: true });
			this.stagingDirectory = null;
		} catch {
			// Keep the path so clear() can retry cleanup during shutdown.
		}
	}

	private metadata(attachment: StoredAttachment): HermesAttachmentMetadata {
		return {
			handle: attachment.handle,
			name: attachment.name,
			size: attachment.size,
			mimeType: attachment.mimeType,
			kind: attachment.kind,
			expiresAt: attachment.expiresAt,
		};
	}
}

interface RendererUploadFile {
	fileId: string;
	path: string;
	name: string;
	size: number;
	written: number;
}

interface RendererUploadBatch {
	uploadId: string;
	ownerId: string;
	directory: string;
	expiresAt: number;
	declaredBytes: number;
	files: RendererUploadFile[];
}

export interface HermesRendererAttachmentUploadManagerOptions {
	idFactory?: () => string;
	now?: () => number;
	ttlMs?: number;
	stagingParentDirectory?: string;
}

const MAX_ACTIVE_RENDERER_UPLOADS = 8;
const MAX_ACTIVE_RENDERER_UPLOAD_BYTES = HERMES_ATTACHMENT_IPC_MAX_BYTES * 4;
const DEFAULT_RENDERER_UPLOAD_TTL_MS = 5 * 60 * 1_000;

/** Main-owned, disk-backed renderer uploads. IPC frames never exceed the exported chunk bound. */
export class HermesRendererAttachmentUploadManager {
	private readonly uploads = new Map<string, RendererUploadBatch>();
	private readonly idFactory: () => string;
	private readonly now: () => number;
	private readonly ttlMs: number;
	private readonly stagingParentDirectory: string;

	constructor(
		private readonly store: HermesAttachmentStore,
		options: HermesRendererAttachmentUploadManagerOptions = {}
	) {
		this.idFactory = options.idFactory ?? randomUUID;
		this.now = options.now ?? Date.now;
		this.ttlMs = options.ttlMs ?? DEFAULT_RENDERER_UPLOAD_TTL_MS;
		this.stagingParentDirectory = options.stagingParentDirectory ?? tmpdir();
	}

	get activeUploads(): number {
		return this.uploads.size;
	}

	begin(
		ownerId: string,
		attachments: HermesRendererAttachmentUploadMetadata[]
	): HermesRendererAttachmentUploadStart {
		this.sweepExpired();
		if (!ownerId) throw new Error("Renderer upload owner is required");
		if (attachments.length === 0 || attachments.length > HERMES_MAX_ATTACHMENTS) {
			throw new Error(`Attach between 1 and ${HERMES_MAX_ATTACHMENTS} files at a time`);
		}
		if ([...this.uploads.values()].some((upload) => upload.ownerId === ownerId)) {
			throw new Error("Finish or cancel the active attachment upload first");
		}
		if (this.uploads.size >= MAX_ACTIVE_RENDERER_UPLOADS) {
			throw new Error("Too many attachment uploads are active");
		}
		const validated = attachments.map(validateRendererAttachmentMetadata);
		const declaredBytes = validated.reduce((total, upload) => total + upload.size, 0);
		if (declaredBytes > HERMES_ATTACHMENT_IPC_MAX_BYTES) {
			throw new Error("Attachment IPC payloads must total 64 MiB or smaller");
		}
		const activeBytes = [...this.uploads.values()].reduce(
			(total, upload) => total + upload.declaredBytes,
			0
		);
		if (activeBytes + declaredBytes > MAX_ACTIVE_RENDERER_UPLOAD_BYTES) {
			throw new Error("Too many attachment upload bytes are active");
		}

		const uploadId = this.uniqueId();
		const directory = mkdtempSync(
			join(this.stagingParentDirectory, "superiorswarm-hermes-upload-")
		);
		chmodSync(directory, 0o700);
		try {
			const files = validated.map((upload, index) => {
				const fileId = this.uniqueId();
				const fileDirectory = join(directory, String(index));
				mkdirSync(fileDirectory, { mode: 0o700 });
				return {
					fileId,
					path: join(fileDirectory, upload.name),
					name: upload.name,
					size: upload.size,
					written: 0,
				};
			});
			this.uploads.set(uploadId, {
				uploadId,
				ownerId,
				directory,
				expiresAt: this.now() + this.ttlMs,
				declaredBytes,
				files,
			});
			return { uploadId, files: files.map(({ fileId }) => ({ fileId })) };
		} catch (error) {
			rmSync(directory, { force: true, recursive: true });
			throw error;
		}
	}

	async append(
		ownerId: string,
		input: { uploadId: string; fileId: string; offset: number; bytes: Uint8Array }
	): Promise<void> {
		this.sweepExpired();
		if (!(input.bytes instanceof Uint8Array)) {
			throw new Error("Attachment upload chunk must be a Uint8Array");
		}
		if (input.bytes.byteLength > HERMES_ATTACHMENT_UPLOAD_CHUNK_MAX_BYTES) {
			throw new Error("Attachment upload chunk exceeds 256 KiB");
		}
		const batch = this.requireUpload(ownerId, input.uploadId);
		const file = batch.files.find((candidate) => candidate.fileId === input.fileId);
		if (!file) throw new Error("Attachment upload is unavailable");
		if (!Number.isSafeInteger(input.offset) || input.offset !== file.written) {
			throw new Error("Attachment upload chunk is out of sequence");
		}
		if (file.written + input.bytes.byteLength > file.size) {
			throw new Error("Attachment upload exceeds its declared size");
		}
		if (input.bytes.byteLength === 0) return;
		const flags =
			file.written === 0
				? constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW
				: constants.O_WRONLY | constants.O_NOFOLLOW;
		const destination = await open(file.path, flags, 0o600);
		try {
			let written = 0;
			while (written < input.bytes.byteLength) {
				const result = await destination.write(
					input.bytes,
					written,
					input.bytes.byteLength - written,
					file.written + written
				);
				if (result.bytesWritten === 0) throw new Error(`Could not stage “${file.name}”`);
				written += result.bytesWritten;
			}
			file.written += written;
			batch.expiresAt = this.now() + this.ttlMs;
		} finally {
			await destination.close();
		}
	}

	async finish(ownerId: string, uploadId: string): Promise<HermesAttachmentMetadata[]> {
		this.sweepExpired();
		const batch = this.requireUpload(ownerId, uploadId);
		for (const file of batch.files) {
			if (file.written !== file.size) throw new Error(`“${file.name}” upload is incomplete`);
			if (file.size === 0) {
				const empty = await open(
					file.path,
					constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
					0o600
				);
				await empty.close();
			}
		}
		try {
			return await this.store.registerPaths(batch.files.map((file) => file.path));
		} finally {
			this.removeUpload(batch);
		}
	}

	cancel(ownerId: string, uploadId: string): void {
		const batch = this.requireUpload(ownerId, uploadId);
		this.removeUpload(batch);
	}

	cancelOwner(ownerId: string): number {
		let cancelled = 0;
		for (const batch of [...this.uploads.values()]) {
			if (batch.ownerId !== ownerId) continue;
			this.removeUpload(batch);
			cancelled++;
		}
		return cancelled;
	}

	clear(): void {
		for (const batch of [...this.uploads.values()]) this.removeUpload(batch);
	}

	sweepExpired(): number {
		const now = this.now();
		let removed = 0;
		for (const batch of [...this.uploads.values()]) {
			if (batch.expiresAt > now) continue;
			this.removeUpload(batch);
			removed++;
		}
		return removed;
	}

	private uniqueId(): string {
		let id = this.idFactory();
		while (this.uploads.has(id)) id = this.idFactory();
		return id;
	}

	private requireUpload(ownerId: string, uploadId: string): RendererUploadBatch {
		const batch = this.uploads.get(uploadId);
		if (!batch || batch.ownerId !== ownerId) throw new Error("Attachment upload is unavailable");
		return batch;
	}

	private removeUpload(batch: RendererUploadBatch): void {
		if (this.uploads.get(batch.uploadId) !== batch) return;
		this.uploads.delete(batch.uploadId);
		rmSync(batch.directory, { force: true, recursive: true });
	}
}

export const hermesAttachmentStore = new HermesAttachmentStore();
export const hermesRendererAttachmentUploads = new HermesRendererAttachmentUploadManager(
	hermesAttachmentStore
);
