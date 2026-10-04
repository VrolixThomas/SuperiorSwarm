import {
	FILE_DROP_MAX_ITEMS,
	FILE_PATH_MAX_BYTES,
	type TerminalFileBatch,
	type TerminalFileDraft,
	displayFilePath,
} from "../../shared/terminal-files";
type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const MAX_DRAFT_BYTES = 1024 * 1024;
function bounded(value: unknown, limit = FILE_PATH_MAX_BYTES): value is string {
	return typeof value === "string" && new TextEncoder().encode(value).length <= limit;
}
/** Retain selection metadata across refresh/reopen; ownership is revalidated before use. */
export class TerminalFileDraftStore {
	private key: string;
	constructor(
		private storage: DraftStorage,
		private workspaceId: string,
		private terminalId: string
	) {
		this.key = `terminal-file-selection:v1:${JSON.stringify([workspaceId, terminalId])}`;
	}
	load(): TerminalFileDraft | null {
		try {
			const text = this.storage.getItem(this.key);
			if (!text || text.length > MAX_DRAFT_BYTES) return null;
			const draft = JSON.parse(text);
			if (
				draft?.version !== 1 ||
				draft.target?.workspaceId !== this.workspaceId ||
				draft.target?.terminalId !== this.terminalId ||
				!bounded(draft.target.root) ||
				(draft.target.rootIdentity !== undefined && !bounded(draft.target.rootIdentity, 200)) ||
				!Array.isArray(draft.entries) ||
				!draft.entries.length ||
				draft.entries.length > FILE_DROP_MAX_ITEMS
			)
				return null;
			if (
				draft.entries.some((entry: unknown) => {
					if (!entry || typeof entry !== "object") return true;
					const value = entry as Record<string, unknown>;
					return (
						!bounded(value["label"], 4096) ||
						(value["path"] !== null && !bounded(value["path"])) ||
						!Number.isSafeInteger(value["size"]) ||
						(value["size"] as number) < 0 ||
						!["file", "directory", "unsupported"].includes(value["kind"] as string) ||
						["external", "symlink", "referenceAllowed", "copyAllowed"].some(
							(key) => typeof value[key] !== "boolean"
						) ||
						["copyId", "identity", "error"].some(
							(key) => value[key] !== undefined && !bounded(value[key], 4096)
						)
					);
				})
			)
				return null;
			// Pick fields again: stored data can never introduce a ready handle or payload.
			return this.selection({
				id: "",
				target: { ...draft.target, generation: "" },
				entries: draft.entries,
			});
		} catch {
			return null;
		}
	}
	private selection(batch: TerminalFileBatch): TerminalFileDraft {
		return {
			version: 1,
			target: {
				terminalId: this.terminalId,
				workspaceId: this.workspaceId,
				root: batch.target.root,
				rootIdentity: batch.target.rootIdentity,
			},
			entries: batch.entries.map((entry) => ({
				label: displayFilePath(entry.label),
				path: entry.path,
				size: entry.size,
				kind: entry.kind,
				external: entry.external,
				symlink: entry.symlink,
				referenceAllowed: entry.referenceAllowed,
				copyAllowed: entry.copyAllowed,
				error: entry.error,
				copyId: entry.copyId,
				identity: entry.identity,
			})),
		};
	}
	save(batch: TerminalFileBatch | null): boolean {
		try {
			if (!batch) {
				this.storage.removeItem(this.key);
				return true;
			}
			if (
				batch.target.workspaceId !== this.workspaceId ||
				batch.target.terminalId !== this.terminalId ||
				batch.entries.length > FILE_DROP_MAX_ITEMS
			)
				throw new Error("Invalid file selection");
			const text = JSON.stringify(this.selection(batch));
			if (new TextEncoder().encode(text).length > MAX_DRAFT_BYTES)
				throw new Error("Selection exceeds storage limit");
			this.storage.setItem(this.key, text);
			return true;
		} catch {
			// Never restore an older selection after a failed update.
			try {
				this.storage.removeItem(this.key);
			} catch {}
			return false;
		}
	}
}
