import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import {
	FILE_COPY_MAX_BYTES,
	FILE_WORKSPACE_MAX_BYTES,
	type TerminalOwnedCopy,
	isSafeTerminalPath,
} from "../../shared/terminal-files";
import { ensureAttachmentExclude } from "../services/git-exclude";
import { type FileSnapshot, recheckFile, snapshotFile } from "./terminal-files";

interface RecordEntry extends Omit<TerminalOwnedCopy, "path"> {
	root: string;
	rootDev: number;
	rootIno: number;
	ino?: number;
}
/** Manifest records ownership only; no source paths, bytes or pending input. */
export class TerminalAttachmentStore {
	private serial: Promise<unknown> = Promise.resolve();
	private pending = 0;
	constructor(
		private localDirectory: string,
		private helper: string
	) {}
	private locked<T>(action: () => Promise<T>): Promise<T> {
		if (this.pending >= 64)
			return Promise.reject(
				new Error("Too many attachment operations. Wait for pending copies to finish.")
			);
		this.pending++;
		const result = this.serial.then(action).finally(() => {
			this.pending--;
		});
		this.serial = result.catch(() => {});
		return result;
	}
	private async records(): Promise<RecordEntry[]> {
		try {
			const file = await open(
				join(this.localDirectory, "terminal-attachments.json"),
				constants.O_RDONLY | constants.O_NOFOLLOW
			);
			try {
				if ((await file.stat()).size > 4 * 1024 ** 2)
					throw new Error("Attachment manifest exceeds limit.");
				const records: unknown = JSON.parse(await file.readFile("utf8"));
				if (
					!Array.isArray(records) ||
					records.length > 4096 ||
					records.some(
						(r) =>
							!r ||
							!/^[a-f0-9-]{36}$/.test(r.id) ||
							typeof r.workspaceId !== "string" ||
							typeof r.root !== "string" ||
							typeof r.label !== "string" ||
							!Number.isSafeInteger(r.size) ||
							r.size < 0 ||
							!Number.isSafeInteger(r.rootDev) ||
							!Number.isSafeInteger(r.rootIno) ||
							!Number.isFinite(r.createdAt)
					)
				)
					throw new Error("Invalid attachment manifest.");
				return records as RecordEntry[];
			} finally {
				await file.close();
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
			throw new Error("Attachment manifest unavailable; copies have been retained.");
		}
	}
	private async save(records: RecordEntry[]): Promise<void> {
		await mkdir(this.localDirectory, { recursive: true, mode: 0o700 });
		const temp = join(this.localDirectory, `terminal-attachments-${randomUUID()}.json`);
		const contents = JSON.stringify(records);
		if (Buffer.byteLength(contents) > 4 * 1024 ** 2)
			throw new Error("Attachment manifest exceeds limit.");
		const file = await open(temp, "wx", 0o600);
		try {
			try {
				await file.writeFile(contents);
				await file.sync();
			} finally {
				await file.close();
			}
			await rename(temp, join(this.localDirectory, "terminal-attachments.json"));
			const directory = await open(
				this.localDirectory,
				constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
			);
			try {
				await directory.sync();
			} finally {
				await directory.close();
			}
		} catch (error) {
			await unlink(temp).catch(() => {});
			throw error;
		}
	}
	private path(record: RecordEntry): string {
		return join(record.root, ".superiorswarm", "attachments", record.id, "file");
	}
	private public(record: RecordEntry): TerminalOwnedCopy {
		return {
			id: record.id,
			workspaceId: record.workspaceId,
			label: record.label,
			size: record.size,
			createdAt: record.createdAt,
			path: this.path(record),
			status: record.ino === undefined ? "incomplete" : "complete",
		};
	}
	private async run(
		mode: "copy" | "delete",
		record: RecordEntry,
		fd: number | undefined,
		signal?: AbortSignal,
		progress?: (bytes: number) => void
	): Promise<void> {
		signal?.throwIfAborted();
		await new Promise<void>((resolve, reject) => {
			const child = spawn(
				this.helper,
				[
					mode,
					record.root,
					record.id,
					String(record.rootDev),
					String(record.rootIno),
					String(mode === "copy" ? record.size : (record.ino ?? 0)),
				],
				{ stdio: ["ignore", "pipe", "ignore", fd ?? "ignore"], shell: false }
			);
			const cancel = () => {
				child.kill("SIGTERM");
			};
			signal?.addEventListener("abort", cancel, { once: true });
			let line = "";
			child.stdout?.on("data", (chunk: Buffer) => {
				line += chunk.toString("ascii");
				const lines = line.split("\n");
				line = lines.pop() ?? "";
				for (const value of lines) {
					const bytes = Number(value);
					if (Number.isSafeInteger(bytes) && bytes >= 0 && bytes <= record.size) progress?.(bytes);
				}
				if (line.length > 64) cancel();
			});
			child.once("error", () => {
				signal?.removeEventListener("abort", cancel);
				reject(
					new Error("Native attachment helper unavailable. Build the desktop application first.")
				);
			});
			child.once("close", (code) => {
				signal?.removeEventListener("abort", cancel);
				if (code === 0 && !signal?.aborted) resolve();
				else
					reject(
						new Error(
							signal?.aborted
								? "Copy cancelled."
								: "Attachment operation failed. Check permissions, free disk space and file changes; nothing was inserted."
						)
					);
			});
			if (signal?.aborted) cancel();
		});
	}
	copy(
		workspaceId: string,
		root: string,
		source: FileSnapshot,
		label: string,
		signal: AbortSignal,
		progress?: (bytes: number) => void
	): Promise<TerminalOwnedCopy> {
		return this.locked(async () => {
			signal.throwIfAborted();
			if (!isSafeTerminalPath(root))
				throw new Error(
					"This workspace contains unsafe terminal characters. Choose a workspace at a safe path before copying."
				);
			if (source.kind !== "file") throw new Error("Directory copying is unsupported.");
			if (source.size > FILE_COPY_MAX_BYTES)
				throw new Error("Copy limit is 2 GiB per file; reference the original instead.");
			await recheckFile(source);
			if ((await realpath(root)) !== root) throw new Error("Workspace root changed.");
			const rootInfo = await lstat(root);
			if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink())
				throw new Error("Workspace root unavailable.");
			const records = await this.records();
			if (
				records.length >= 4096 ||
				records
					.filter((r) => r.workspaceId === workspaceId || r.root === root)
					.reduce((sum, r) => sum + r.size, source.size) > FILE_WORKSPACE_MAX_BYTES
			)
				throw new Error(
					"Workspace copy quota is 4 GiB. Delete owned copies or reference originals."
				);
			await ensureAttachmentExclude(root, this.helper);
			const record: RecordEntry = {
				id: randomUUID(),
				workspaceId,
				root,
				rootDev: rootInfo.dev,
				rootIno: rootInfo.ino,
				label,
				size: source.size,
				createdAt: Date.now(),
			};
			const input = await open(
				source.path,
				constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
			);
			try {
				const st = await input.stat();
				if (
					!st.isFile() ||
					st.dev !== source.dev ||
					st.ino !== source.ino ||
					st.size !== source.size ||
					st.mtimeMs !== source.mtimeMs ||
					st.ctimeMs !== source.ctimeMs
				)
					throw new Error("Source changed before copy.");
				// Reserve ownership durably before copying. A crash leaves a visible owned record,
				// never an unowned file that cleanup might guess at.
				records.push(record);
				await this.save(records);
				try {
					await this.run("copy", record, input.fd, signal, progress);
					await recheckFile(source);
					signal.throwIfAborted();
					const copied = await snapshotFile(this.path(record));
					record.ino = copied.ino;
					if (copied.size !== source.size) throw new Error("Copied file changed.");
					await this.save(records);
					progress?.(record.size);
					return this.public(record);
				} catch (error) {
					// Helper cleans its partial copy; a successful publication followed by a
					// source change is explicitly removed using the same containment boundary.
					try {
						await this.run("delete", record, undefined);
						await this.save(records.filter((r) => r.id !== record.id));
					} catch {
						/* Preserve ownership if containment or cleanup is uncertain. */
					}
					throw error;
				}
			} finally {
				await input.close();
			}
		});
	}
	list(workspaceId: string, root: string): Promise<TerminalOwnedCopy[]> {
		return this.locked(async () =>
			(await this.records())
				.filter((r) => r.workspaceId === workspaceId && r.root === root)
				.map((r) => this.public(r))
		);
	}
	delete(workspaceId: string, root: string, id: string): Promise<void> {
		return this.locked(async () => {
			const records = await this.records();
			const record = records.find(
				(r) => r.id === id && r.workspaceId === workspaceId && r.root === root
			);
			if (!record) throw new Error("Copy is not owned by this workspace.");
			await this.run("delete", record, undefined);
			await this.save(records.filter((r) => r !== record));
		});
	}
}
