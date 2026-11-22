import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import type {
	ReviewSnapshot,
	ReviewSnapshotContent,
	ReviewSnapshotContextRequest,
	ReviewSnapshotFile,
	ReviewSnapshotFileRequest,
	ReviewSnapshotObject,
	ReviewSnapshotRevision,
} from "../../shared/review-snapshot-types";
import { GitReadError, readGit } from "./git-reader";

export const SNAPSHOT_ERRORS = {
	INVALID_REVISION: "Review revisions must be full local commit IDs",
	OBJECT_UNAVAILABLE:
		"Review commit objects are unavailable locally. Acquire the revision before retrying",
	WORKSPACE_UNAVAILABLE: "Review workspace is unavailable",
	WORKSPACE_CHANGED: "Review workspace changed. Reopen the snapshot",
	SHALLOW_HISTORY: "Complete local history is required to establish the review merge base",
	MERGE_BASE_UNAVAILABLE: "A local merge base could not be established",
	AMBIGUOUS_MERGE_BASE:
		"Multiple merge bases exist. This comparison requires an explicit base strategy",
	MANIFEST_LIMIT: "The changed-file manifest exceeds the snapshot limit",
	MANIFEST_UNAVAILABLE: "The local changed-file manifest could not be read",
	SNAPSHOT_UNAVAILABLE: "Review snapshot is unavailable. Reopen the revision",
	FILE_UNAVAILABLE: "The file does not belong to this review snapshot",
	CANCELLED: "Review snapshot request was cancelled or timed out",
	BUSY: "Review snapshot reader is busy. Retry shortly",
} as const;

export class ReviewSnapshotError extends Error {
	constructor(readonly code: keyof typeof SNAPSHOT_ERRORS) {
		super(SNAPSHOT_ERRORS[code]);
	}
}

const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const decode = (buffer: Buffer) =>
	new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer);

interface CachedSnapshot {
	root: string;
	snapshot: ReviewSnapshot;
}

interface SnapshotOptions {
	resolveRoot: (workspaceId: string) => Promise<string>;
	maxSnapshots?: number;
	maxFiles?: number;
	maxQueued?: number;
	requestTimeoutMs?: number;
}

/** Pure metadata decoding: NUL separation preserves spaces, tabs and newlines in paths. */
function parseManifest(raw: Buffer, maxFiles: number): ReviewSnapshotFile[] {
	const fields = decode(raw).split("\0");
	const files: ReviewSnapshotFile[] = [];
	let index = 0;
	while (index < fields.length - 1) {
		const header = fields[index++];
		const match = /^:(\d{6}) (\d{6}) ([0-9a-f]+) ([0-9a-f]+) ([AMDRCT])\d*$/.exec(header ?? "");
		const oldPath = fields[index++];
		if (!match || !oldPath) throw new ReviewSnapshotError("MANIFEST_UNAVAILABLE");
		const [, oldMode, newMode, oldOid, newOid, change] = match;
		const path = change === "R" || change === "C" ? fields[index++] : oldPath;
		if (
			!path ||
			!oldOid ||
			!newOid ||
			!OID.test(oldOid) ||
			!OID.test(newOid) ||
			!oldMode ||
			!newMode
		)
			throw new ReviewSnapshotError("MANIFEST_UNAVAILABLE");
		const statuses: Record<string, ReviewSnapshotFile["status"]> = {
			A: "added",
			M: "modified",
			D: "deleted",
			R: "renamed",
			C: "copied",
			T: "type-changed",
		};
		const status = statuses[change ?? ""];
		if (!status) throw new ReviewSnapshotError("MANIFEST_UNAVAILABLE");
		const file: ReviewSnapshotFile = {
			id: hash([oldPath, path, oldMode, newMode, oldOid, newOid]),
			path,
			...(oldPath !== path ? { oldPath } : {}),
			status,
			base: oldMode === "000000" ? null : { path: oldPath, mode: oldMode, oid: oldOid },
			head: newMode === "000000" ? null : { path, mode: newMode, oid: newOid },
		};
		files.push(file);
		if (files.length > maxFiles) throw new ReviewSnapshotError("MANIFEST_LIMIT");
	}
	return files.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
}

/** Local-only service. Cache entries are owned by a registered workspace and canonical root. */
export class ReviewSnapshotService {
	private readonly cache = new Map<string, CachedSnapshot>();
	private active = 0;
	private readonly queue: Array<() => void> = [];
	private readonly maxQueued: number;
	private readonly requestTimeoutMs: number;
	private readonly maxSnapshots: number;
	private readonly maxFiles: number;

	constructor(private readonly options: SnapshotOptions) {
		this.maxSnapshots = Math.max(1, Math.min(8, options.maxSnapshots ?? 8));
		this.maxQueued = Math.max(0, Math.min(32, options.maxQueued ?? 16));
		this.requestTimeoutMs = Math.max(1, Math.min(15_000, options.requestTimeoutMs ?? 15_000));
		this.maxFiles = Math.max(1, Math.min(10_000, options.maxFiles ?? 10_000));
	}

	/** Reserve at most two readers; queued work shares the request deadline. */
	private acquire(signal: AbortSignal): Promise<void> {
		if (signal.aborted) return Promise.reject(new ReviewSnapshotError("CANCELLED"));
		if (this.active < 2) {
			this.active++;
			return Promise.resolve();
		}
		if (this.queue.length >= this.maxQueued) return Promise.reject(new ReviewSnapshotError("BUSY"));
		return new Promise((resolve, reject) => {
			const start = () => {
				signal.removeEventListener("abort", cancel);
				this.active++;
				resolve();
			};
			const cancel = () => {
				const index = this.queue.indexOf(start);
				if (index >= 0) this.queue.splice(index, 1);
				reject(new ReviewSnapshotError("CANCELLED"));
			};
			this.queue.push(start);
			signal.addEventListener("abort", cancel, { once: true });
		});
	}

	private release() {
		this.active--;
		this.queue.shift()?.();
	}

	private async run<T>(
		action: (signal: AbortSignal) => Promise<T>,
		callerSignal?: AbortSignal
	): Promise<T> {
		if (callerSignal?.aborted) throw new ReviewSnapshotError("CANCELLED");
		const deadline = new AbortController();
		const timer = setTimeout(() => deadline.abort(), this.requestTimeoutMs);
		timer.unref();
		const signal = callerSignal
			? AbortSignal.any([deadline.signal, callerSignal])
			: deadline.signal;
		let onAbort = () => {};
		try {
			await this.acquire(signal);
			// Retain the slot until the underlying action settles, even if the caller
			// has already received cancellation. A slow root lookup must not oversubscribe Git.
			const work = Promise.resolve().then(() => {
				if (signal.aborted) throw new ReviewSnapshotError("CANCELLED");
				return action(signal);
			});
			void work.then(
				() => this.release(),
				() => this.release()
			);
			const cancelled = new Promise<never>((_resolve, reject) => {
				onAbort = () => reject(new ReviewSnapshotError("CANCELLED"));
				signal.addEventListener("abort", onAbort, { once: true });
				if (signal.aborted) onAbort();
			});
			const result = await Promise.race([work, cancelled]);
			if (signal.aborted) throw new ReviewSnapshotError("CANCELLED");
			return result;
		} catch (error) {
			if (signal.aborted || (error instanceof GitReadError && error.reason === "cancelled"))
				throw new ReviewSnapshotError("CANCELLED");
			throw error;
		} finally {
			clearTimeout(timer);
			signal.removeEventListener("abort", onAbort);
		}
	}

	private async root(workspaceId: string): Promise<string> {
		try {
			return await realpath(await this.options.resolveRoot(workspaceId));
		} catch {
			throw new ReviewSnapshotError("WORKSPACE_UNAVAILABLE");
		}
	}

	create(input: ReviewSnapshotRevision, callerSignal?: AbortSignal): Promise<ReviewSnapshot> {
		return this.run(async (signal) => {
			if (!OID.test(input.targetTipOid) || !OID.test(input.headOid))
				throw new ReviewSnapshotError("INVALID_REVISION");
			const root = await this.root(input.workspaceId);
			if (signal.aborted) throw new ReviewSnapshotError("CANCELLED");
			const repositoryKey = hash(root);
			const id = hash([
				1,
				input.workspaceId,
				repositoryKey,
				input.targetTipOid,
				input.headOid,
				input.review,
			]);
			const existing = this.cache.get(id);
			if (existing) {
				this.cache.delete(id);
				this.cache.set(id, existing);
				return structuredClone(existing.snapshot);
			}
			try {
				const top = decode(await readGit(root, ["rev-parse", "--show-toplevel"], signal)).replace(
					/\n$/,
					""
				);
				if ((await realpath(top)) !== root) throw new ReviewSnapshotError("WORKSPACE_UNAVAILABLE");
			} catch {
				throw new ReviewSnapshotError("WORKSPACE_UNAVAILABLE");
			}
			for (const oid of [input.targetTipOid, input.headOid]) {
				let type: string;
				try {
					type = decode(await readGit(root, ["cat-file", "-t", oid], signal)).trim();
				} catch {
					throw new ReviewSnapshotError("OBJECT_UNAVAILABLE");
				}
				if (type !== "commit") throw new ReviewSnapshotError("INVALID_REVISION");
			}
			if (
				decode(await readGit(root, ["rev-parse", "--is-shallow-repository"], signal)).trim() !==
				"false"
			)
				throw new ReviewSnapshotError("SHALLOW_HISTORY");
			let bases: string[];
			try {
				bases = decode(
					await readGit(root, ["merge-base", "--all", input.targetTipOid, input.headOid], signal)
				)
					.trim()
					.split("\n");
			} catch {
				throw new ReviewSnapshotError("MERGE_BASE_UNAVAILABLE");
			}
			if (bases.length > 1) throw new ReviewSnapshotError("AMBIGUOUS_MERGE_BASE");
			const mergeBaseOid = bases[0];
			if (!mergeBaseOid || !OID.test(mergeBaseOid))
				throw new ReviewSnapshotError("MERGE_BASE_UNAVAILABLE");
			let files: ReviewSnapshotFile[];
			try {
				files = parseManifest(
					await readGit(
						root,
						[
							"diff",
							"--raw",
							"-z",
							"--no-abbrev",
							"--no-ext-diff",
							"--no-textconv",
							"--find-renames=50%",
							"-l1000",
							"--ignore-submodules=none",
							mergeBaseOid,
							input.headOid,
							"--",
						],
						signal
					),
					this.maxFiles
				);
			} catch (error) {
				if (error instanceof ReviewSnapshotError) throw error;
				throw new ReviewSnapshotError(
					error instanceof GitReadError && error.reason === "limit"
						? "MANIFEST_LIMIT"
						: "MANIFEST_UNAVAILABLE"
				);
			}
			if (signal.aborted) throw new ReviewSnapshotError("CANCELLED");
			const snapshot: ReviewSnapshot = {
				version: 1,
				id,
				repositoryKey,
				...input,
				mergeBaseOid,
				files,
				renameDetection: "bounded",
			};
			this.cache.set(id, { root, snapshot });
			while (this.cache.size > this.maxSnapshots) {
				const oldest = this.cache.keys().next().value;
				if (oldest) this.cache.delete(oldest);
			}
			return structuredClone(snapshot);
		}, callerSignal);
	}

	read(
		input: ReviewSnapshotFileRequest,
		callerSignal?: AbortSignal
	): Promise<ReviewSnapshotContent> {
		return this.run(async (signal) => {
			const cached = await this.getCached(input, signal);
			const root = cached.root;
			const file = cached.snapshot.files.find((entry) => entry.id === input.fileId);
			if (!file || (input.side !== "base" && input.side !== "head"))
				throw new ReviewSnapshotError("FILE_UNAVAILABLE");
			this.cache.delete(input.snapshotId);
			this.cache.set(input.snapshotId, cached);
			const object = file[input.side];
			if (!object) return { kind: "absent" };
			return this.readObject(root, object, signal);
		}, callerSignal);
	}

	readContext(
		input: ReviewSnapshotContextRequest,
		callerSignal?: AbortSignal
	): Promise<ReviewSnapshotContent> {
		return this.run(async (signal) => {
			if (
				!input.path ||
				Buffer.byteLength(input.path) > 4096 ||
				/[\\\0]/.test(input.path) ||
				input.path.split("/").some((part) => !part || part === "." || part === "..") ||
				(input.side !== "base" && input.side !== "head")
			)
				throw new ReviewSnapshotError("FILE_UNAVAILABLE");
			const cached = await this.getCached(input, signal);
			const commit = input.side === "head" ? cached.snapshot.headOid : cached.snapshot.mergeBaseOid;
			let raw: string;
			try {
				// Literal pathspecs never follow worktree symlinks or expand wildcard paths.
				raw = decode(
					await readGit(
						cached.root,
						["ls-tree", "-z", "--full-tree", commit, "--", `:(literal)${input.path}`],
						signal
					)
				);
			} catch {
				throw new ReviewSnapshotError("OBJECT_UNAVAILABLE");
			}
			if (!raw) return { kind: "absent" };
			const match = /^(\d{6}) (?:blob|tree|commit) ([0-9a-f]+)\t([^\0]+)\0$/.exec(raw);
			if (!match || match[3] !== input.path || !match[1] || !match[2] || !OID.test(match[2]))
				throw new ReviewSnapshotError("FILE_UNAVAILABLE");
			return this.readObject(
				cached.root,
				{ mode: match[1], oid: match[2], path: input.path },
				signal
			);
		}, callerSignal);
	}

	private async getCached(
		input: { workspaceId: string; snapshotId: string },
		signal: AbortSignal
	): Promise<CachedSnapshot> {
		const cached = this.cache.get(input.snapshotId);
		if (!cached || cached.snapshot.workspaceId !== input.workspaceId)
			throw new ReviewSnapshotError("SNAPSHOT_UNAVAILABLE");
		const root = await this.root(input.workspaceId);
		if (signal.aborted) throw new ReviewSnapshotError("CANCELLED");
		if (root !== cached.root) throw new ReviewSnapshotError("WORKSPACE_CHANGED");
		// Root lookup can yield while another request evicts this snapshot.
		if (this.cache.get(input.snapshotId) !== cached)
			throw new ReviewSnapshotError("SNAPSHOT_UNAVAILABLE");

		this.cache.delete(input.snapshotId);
		this.cache.set(input.snapshotId, cached);
		return cached;
	}

	private async readObject(
		root: string,
		object: ReviewSnapshotObject,
		signal: AbortSignal
	): Promise<ReviewSnapshotContent> {
		const location = { path: object.path, blobOid: object.oid };
		const omitted = (
			reason: Extract<ReviewSnapshotContent, { kind: "omitted" }>["reason"]
		): ReviewSnapshotContent => ({ kind: "omitted", reason, ...location });
		if (object.mode === "120000") return omitted("symlink");
		if (object.mode === "160000") return omitted("submodule");
		if (object.mode !== "100644" && object.mode !== "100755") return omitted("unsupported-mode");
		let bytes: Buffer;
		try {
			const size = Number(
				decode(await readGit(root, ["cat-file", "-s", object.oid], signal)).trim()
			);
			if (!Number.isSafeInteger(size) || size < 0) throw new Error("Invalid blob size");
			if (size > 1024 * 1024) return omitted("too-large");
			bytes = await readGit(root, ["cat-file", "blob", object.oid], signal);
		} catch {
			return { kind: "unavailable", reason: "object-unavailable", ...location };
		}
		if (bytes.includes(0)) return omitted("binary");
		let content: string;
		try {
			content = decode(bytes);
		} catch {
			return omitted("non-utf8");
		}
		if (content.startsWith("version https://git-lfs.github.com/spec/v1\n"))
			return omitted("lfs-pointer");
		return { kind: "text", content, ...location };
	}
}
