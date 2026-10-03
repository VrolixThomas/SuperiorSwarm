import { createHash, randomUUID } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import { lstat, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative } from "node:path";
import {
	FILE_BATCH_TTL_MS,
	FILE_DROP_MAX_ITEMS,
	FILE_PATH_MAX_BYTES,
	type TerminalFileBatch,
	type TerminalFileEntry,
	type TerminalFileTarget,
	displayFilePath,
	formatFilePaths,
	isSafeTerminalPath,
} from "../../shared/terminal-files";

export interface FileCaller {
	senderId: number;
	frameId: number;
}
interface Owner {
	rootDev: number;
	rootIno: number;
	caller: FileCaller;
	target: TerminalFileTarget;
}
export class TerminalFileOwners {
	private owners = new Map<string, Owner>();
	private listeners = new Set<(id: string) => void>();
	onInvalidated(listener: (id: string) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
	private notify(id: string): void {
		for (const listener of this.listeners) listener(id);
	}
	attach(terminalId: string, caller: FileCaller, workspaceId: string, root: string): void {
		this.notify(terminalId);
		const info = lstatSync(root);
		if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(root) !== root)
			throw new Error("Workspace root is not canonical.");
		this.owners.set(terminalId, {
			rootDev: info.dev,
			rootIno: info.ino,
			caller,
			target: {
				terminalId,
				generation: randomUUID(),
				workspaceId,
				root,
				rootIdentity: `${info.dev}:${info.ino}`,
			},
		});
	}
	target(terminalId: string, caller: FileCaller): TerminalFileTarget {
		const owner = this.owners.get(terminalId);
		if (
			!owner ||
			owner.caller.senderId !== caller.senderId ||
			owner.caller.frameId !== caller.frameId
		)
			throw new Error("This terminal belongs to another window or is no longer attached.");
		const info = lstatSync(owner.target.root);
		if (
			!info.isDirectory() ||
			info.isSymbolicLink() ||
			info.dev !== owner.rootDev ||
			info.ino !== owner.rootIno ||
			realpathSync(owner.target.root) !== owner.target.root
		)
			throw new Error("Workspace root changed. Reopen the terminal.");
		return { ...owner.target };
	}
	assert(caller: FileCaller, target: TerminalFileTarget): void {
		const current = this.target(target.terminalId, caller);
		if (
			current.generation !== target.generation ||
			current.workspaceId !== target.workspaceId ||
			current.root !== target.root
		)
			throw new Error("Terminal session changed. Drop the files again.");
	}
	invalidate(terminalId: string, _reason: string): void {
		this.notify(terminalId);
		const owner = this.owners.get(terminalId);
		if (owner) owner.target = { ...owner.target, generation: randomUUID() };
	}
	invalidateSender(senderId: number): void {
		for (const [id, owner] of this.owners) if (owner.caller.senderId === senderId) this.detach(id);
	}
	invalidateAll(): void {
		for (const id of this.owners.keys()) this.invalidate(id, "connection changed");
	}
	detach(terminalId: string): void {
		this.notify(terminalId);
		this.owners.delete(terminalId);
	}
}
export const terminalFileOwners = new TerminalFileOwners();

export interface FileSnapshot {
	path: string;
	dev: number;
	ino: number;
	size: number;
	mtimeMs: number;
	ctimeMs: number;
	kind: "file" | "directory";
}
export function isContained(root: string, path: string): boolean {
	const rel = relative(root, path);
	return rel === "" || (!rel.startsWith("../") && rel !== ".." && !isAbsolute(rel));
}
export async function snapshotFile(path: string): Promise<FileSnapshot> {
	if (
		!isAbsolute(path) ||
		path.includes("\0") ||
		Buffer.byteLength(path) > FILE_PATH_MAX_BYTES ||
		Buffer.from(path, "utf8").toString("utf8") !== path
	)
		throw new Error("Invalid native path.");
	const canonical = await realpath(path);
	const info = await stat(canonical);
	if (!info.isFile() && !info.isDirectory())
		throw new Error("Only regular files and directory references are supported.");
	if (
		![info.dev, info.ino, info.size].every((n) => Number.isSafeInteger(n) && n >= 0) ||
		!Number.isFinite(info.mtimeMs) ||
		!Number.isFinite(info.ctimeMs)
	)
		throw new Error("Invalid filesystem metadata.");
	return {
		path: canonical,
		dev: info.dev,
		ino: info.ino,
		size: info.size,
		mtimeMs: info.mtimeMs,
		ctimeMs: info.ctimeMs,
		kind: info.isFile() ? "file" : "directory",
	};
}
function fileIdentity(snapshot: FileSnapshot): string {
	// Metadata only: never hash or read a reference's file contents.
	return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}
export function sameFile(a: FileSnapshot, b: FileSnapshot): boolean {
	return (
		a.path === b.path &&
		a.dev === b.dev &&
		a.ino === b.ino &&
		a.size === b.size &&
		a.mtimeMs === b.mtimeMs &&
		a.ctimeMs === b.ctimeMs &&
		a.kind === b.kind
	);
}
export async function recheckFile(snapshot: FileSnapshot): Promise<void> {
	if (!sameFile(snapshot, await snapshotFile(snapshot.path)))
		throw new Error("File changed or was replaced. Drop it again.");
}
interface StoredBatch {
	batch: TerminalFileBatch;
	caller: FileCaller;
	expires: number;
	snapshots: Map<string, FileSnapshot>;
	abort: AbortController;
	insertion?: string;
	editing?: boolean;
}
export class TerminalFileService {
	private batches = new Map<string, StoredBatch>();
	constructor(private owners: TerminalFileOwners) {
		owners.onInvalidated((id) => {
			for (const [key, stored] of this.batches)
				if (stored.batch.target.terminalId === id) {
					stored.abort.abort();
					this.batches.delete(key);
				}
		});
	}
	async prepare(
		caller: FileCaller,
		target: TerminalFileTarget,
		paths: Array<string | null>
	): Promise<TerminalFileBatch> {
		this.owners.assert(caller, target);
		if (!paths.length || paths.length > FILE_DROP_MAX_ITEMS)
			throw new Error("Drop between 1 and 64 files.");
		for (const [id, batch] of this.batches) {
			if (
				batch.expires < Date.now() ||
				(batch.caller.senderId === caller.senderId &&
					batch.batch.target.terminalId === target.terminalId)
			) {
				batch.abort.abort();
				this.batches.delete(id);
			}
		}
		if (this.batches.size >= 128)
			throw new Error("Too many pending batches. Clear pending files first.");
		const batch: TerminalFileBatch = { id: randomUUID(), target: { ...target }, entries: [] };
		const stored: StoredBatch = {
			batch,
			caller,
			expires: Date.now() + FILE_BATCH_TTL_MS,
			snapshots: new Map(),
			abort: new AbortController(),
		};
		this.batches.set(batch.id, stored);
		try {
			const prepared = await this.describe(paths, target.root);
			this.get(caller, batch.id);
			batch.entries = prepared.entries;
			stored.snapshots = prepared.snapshots;
			return batch;
		} catch (error) {
			this.batches.delete(batch.id);
			throw error;
		}
	}

	private async describe(paths: Array<string | null>, root: string) {
		const entries: TerminalFileEntry[] = [];
		const snapshots = new Map<string, FileSnapshot>();
		for (const path of paths) {
			const id = randomUUID();
			try {
				if (!path) throw new Error("Save this file locally, then drop it again.");
				const snapshot = await snapshotFile(path);
				const source = await lstat(path);
				snapshots.set(id, snapshot);
				entries.push({
					id,
					label: displayFilePath(path.slice(path.lastIndexOf("/") + 1) || path),
					path: snapshot.path,
					identity: fileIdentity(snapshot),
					size: snapshot.size,
					kind: snapshot.kind,
					external: !isContained(root, snapshot.path),
					symlink: source.isSymbolicLink() || path !== snapshot.path,
					referenceAllowed: isSafeTerminalPath(path) && isSafeTerminalPath(snapshot.path),
					copyAllowed: snapshot.kind === "file",
				});
			} catch (error) {
				// Do not expose OS error strings (they can contain unescaped paths).
				entries.push({
					id,
					label: displayFilePath(
						path ? path.slice(path.lastIndexOf("/") + 1) || path : "Virtual file"
					),
					path: null,
					size: 0,
					kind: "unsupported",
					external: false,
					symlink: false,
					referenceAllowed: false,
					copyAllowed: false,
					error: path
						? "File unavailable or unsupported. Only existing regular files and directory references are supported."
						: "Save this file locally, then drop it again.",
				});
			}
		}
		return { entries, snapshots };
	}
	batchTarget(caller: FileCaller, batchId: string): TerminalFileTarget {
		return { ...this.get(caller, batchId).batch.target };
	}
	async append(
		caller: FileCaller,
		batchId: string,
		paths: Array<string | null>,
		retainedIds: string[]
	): Promise<TerminalFileBatch> {
		const stored = this.get(caller, batchId);
		if (stored.editing) throw new Error("Files are already being added. Try again when ready.");
		if (!paths.length || paths.length + retainedIds.length > FILE_DROP_MAX_ITEMS)
			throw new Error("Choose at most 64 files in total. Earlier files are still selected.");
		const selected = new Set(retainedIds);
		const retained = stored.batch.entries.filter((entry) => selected.has(entry.id));
		if (selected.size !== retainedIds.length || retained.length !== retainedIds.length)
			throw new Error("Invalid file selection.");
		stored.editing = true;
		try {
			const prepared = await this.describe(paths, stored.batch.target.root);
			this.get(caller, batchId);
			stored.batch = { ...stored.batch, entries: [...retained, ...prepared.entries] };
			stored.snapshots = new Map(
				[...stored.snapshots].filter(([id]) => selected.has(id)).concat([...prepared.snapshots])
			);
			stored.insertion = undefined;
			return stored.batch;
		} finally {
			stored.editing = false;
		}
	}

	private get(caller: FileCaller, id: string): StoredBatch {
		const stored = this.batches.get(id);
		if (!stored || stored.abort.signal.aborted || stored.expires < Date.now())
			throw new Error("Pending files expired or were cleared. Drop them again.");
		if (stored.caller.senderId !== caller.senderId || stored.caller.frameId !== caller.frameId)
			throw new Error("Files belong to another window.");
		this.owners.assert(caller, stored.batch.target);
		return stored;
	}
	select(caller: FileCaller, batchId: string, ids: string[]): TerminalFileEntry[] {
		const stored = this.get(caller, batchId);
		if (stored.editing) throw new Error("Wait for files to finish being added.");
		if (!ids.length || ids.length > FILE_DROP_MAX_ITEMS || new Set(ids).size !== ids.length)
			throw new Error("Invalid file selection.");
		const entries = ids.map((id) => stored.batch.entries.find((e) => e.id === id));
		if (entries.some((e) => !e?.referenceAllowed || !e.path))
			throw new Error("Selected files need a safe workspace copy or removal before insertion.");
		return entries as TerminalFileEntry[];
	}
	copySource(caller: FileCaller, batchId: string, id: string) {
		const stored = this.get(caller, batchId);
		const entry = stored.batch.entries.find((e) => e.id === id);
		const snapshot = stored.snapshots.get(id);
		if (!entry?.copyAllowed || !snapshot) throw new Error("This file cannot be copied.");
		return { target: stored.batch.target, entry, snapshot, signal: stored.abort.signal };
	}
	async copied(
		caller: FileCaller,
		batchId: string,
		id: string,
		copyId: string,
		path: string
	): Promise<TerminalFileBatch> {
		const snapshot = await snapshotFile(path);
		const stored = this.get(caller, batchId);
		const entry = stored.batch.entries.find((e) => e.id === id);
		if (!entry || !isContained(stored.batch.target.root, path))
			throw new Error("Copy is outside workspace.");
		stored.snapshots.set(id, snapshot);
		Object.assign(entry, {
			path,
			identity: fileIdentity(snapshot),
			copyId,
			size: snapshot.size,
			referenceAllowed: isSafeTerminalPath(path),
			copyAllowed: false,
			external: false,
			symlink: false,
		});
		stored.insertion = undefined;
		return stored.batch;
	}
	async resolve(
		caller: FileCaller,
		batchId: string,
		ids: string[]
	): Promise<{ text: string; target: TerminalFileTarget }> {
		const entries = this.select(caller, batchId, ids);
		const stored = this.get(caller, batchId);
		const reviewedBatch = stored.batch;
		for (const entry of entries) {
			const snapshot = stored.snapshots.get(entry.id);
			if (!snapshot) throw new Error("File metadata unavailable.");
			await recheckFile(snapshot);
		}
		this.get(caller, batchId);
		if (stored.editing || stored.batch !== reviewedBatch)
			throw new Error("File selection changed. Review it before sending.");
		const text = formatFilePaths(entries.map((entry) => entry.path as string));
		stored.insertion = text;
		return { text, target: stored.batch.target };
	}
	consume(caller: FileCaller, batchId: string, text: string): TerminalFileTarget {
		const stored = this.get(caller, batchId);
		if (stored.editing || !stored.insertion || stored.insertion !== text)
			throw new Error("Insertion was not prepared.");
		this.batches.delete(batchId);
		return stored.batch.target;
	}
	cancel(caller: FileCaller, batchId: string): void {
		const stored = this.batches.get(batchId);
		if (
			!stored ||
			stored.caller.senderId !== caller.senderId ||
			stored.caller.frameId !== caller.frameId
		)
			return;
		stored.abort.abort();
		this.batches.delete(batchId);
	}
}
