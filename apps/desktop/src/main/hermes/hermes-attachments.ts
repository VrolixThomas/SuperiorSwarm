import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import type { HermesAttachmentKind, HermesAttachmentMetadata } from "../../shared/hermes";
import {
	HERMES_ATTACHMENT_CONTEXT_END,
	HERMES_ATTACHMENT_CONTEXT_START,
} from "../../shared/hermes";

export const HERMES_MAX_ATTACHMENTS = 10;
export const HERMES_IMAGE_ATTACHMENT_MAX_BYTES = 16 * 1024 * 1024;
export const HERMES_PDF_ATTACHMENT_MAX_BYTES = 50 * 1024 * 1024;
// Stock Hermes accepts a larger dedicated remote-file payload. SuperiorSwarm keeps a
// conservative 32 MiB app cap to bound main-process reads and WebSocket frames.
export const HERMES_GENERAL_ATTACHMENT_MAX_BYTES = 32 * 1024 * 1024;
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
	modifiedAtMs: number;
	attachedByRuntime: Map<string, HermesAttachedResult>;
}

export interface HermesAttachmentStoreOptions {
	idFactory?: () => string;
	now?: () => number;
	ttlMs?: number;
}

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

export class HermesAttachmentStore {
	private readonly attachments = new Map<string, StoredAttachment>();
	private readonly expiredHandles = new Set<string>();
	private readonly idFactory: () => string;
	private readonly now: () => number;
	private readonly ttlMs: number;

	constructor(options: HermesAttachmentStoreOptions = {}) {
		this.idFactory = options.idFactory ?? randomUUID;
		this.now = options.now ?? Date.now;
		this.ttlMs = options.ttlMs ?? HERMES_ATTACHMENT_TTL_MS;
	}

	get size(): number {
		return this.attachments.size;
	}

	async registerPaths(paths: string[]): Promise<HermesAttachmentMetadata[]> {
		this.sweepExpired();
		if (paths.length > HERMES_MAX_ATTACHMENTS) {
			throw new Error(`Select up to ${HERMES_MAX_ATTACHMENTS} attachments at a time`);
		}
		const pending: Array<Omit<StoredAttachment, "handle" | "expiresAt">> = [];
		for (const path of paths) {
			const name = safeFileName(path);
			let info: Awaited<ReturnType<typeof stat>>;
			try {
				info = await stat(path);
			} catch {
				throw new Error(`“${name}” no longer exists`);
			}
			if (!info.isFile()) throw new Error(`“${name}” is not a regular file`);
			const type = attachmentType(path);
			if (info.size > type.maxBytes) throw new Error(`${type.tooLargeMessage}: “${name}”`);
			pending.push({
				path,
				name,
				size: info.size,
				mimeType: type.mimeType,
				kind: type.kind,
				modifiedAtMs: info.mtimeMs,
				attachedByRuntime: new Map(),
			});
		}

		const expiresAt = this.now() + this.ttlMs;
		const created: StoredAttachment[] = [];
		for (const candidate of pending) {
			let handle = this.idFactory();
			while (this.attachments.has(handle)) handle = this.idFactory();
			this.expiredHandles.delete(handle);
			const attachment = { ...candidate, handle, expiresAt };
			this.attachments.set(handle, attachment);
			created.push(attachment);
		}
		return created.map(this.metadata);
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
			let info: Awaited<ReturnType<typeof stat>>;
			try {
				info = await stat(attachment.path);
			} catch {
				throw new Error(`“${attachment.name}” no longer exists`);
			}
			if (!info.isFile()) throw new Error(`“${attachment.name}” is not a regular file`);
			if (info.size !== attachment.size || info.mtimeMs !== attachment.modifiedAtMs) {
				throw new Error(`“${attachment.name}” changed after selection; select it again`);
			}
			resolved.push({ ...this.metadata(attachment), path: attachment.path });
		}
		return resolved;
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

	release(handles: string[]): void {
		for (const handle of handles) {
			this.attachments.delete(handle);
			this.expiredHandles.delete(handle);
		}
	}

	clear(): void {
		this.attachments.clear();
		this.expiredHandles.clear();
	}

	sweepExpired(): number {
		const now = this.now();
		let removed = 0;
		for (const [handle, attachment] of this.attachments) {
			if (attachment.expiresAt > now) continue;
			this.attachments.delete(handle);
			this.expiredHandles.add(handle);
			removed++;
		}
		return removed;
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

export const hermesAttachmentStore = new HermesAttachmentStore();
