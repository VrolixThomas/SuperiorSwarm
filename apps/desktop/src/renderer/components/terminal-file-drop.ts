import { FILE_DROP_MAX_ITEMS, FILE_PASTE_MAX_BYTES } from "../../shared/terminal-files";

const TAB_DRAG_MIME = "application/x-superiorswarm-tab";
export function isFileDrag(transfer: DataTransfer | null): boolean {
	const types = Array.from(transfer?.types ?? []);
	return types.includes("Files") && !types.includes(TAB_DRAG_MIME);
}
export function filesFromTransfer(transfer: DataTransfer): File[] {
	if (transfer.files.length > FILE_DROP_MAX_ITEMS) throw new Error("Drop at most 64 files.");
	if (transfer.files.length) return Array.from(transfer.files);
	const files: File[] = [];
	if (transfer.items.length > 128) throw new Error("Too many drag items. Drop at most 64 files.");
	for (const item of transfer.items) {
		if (item.kind !== "file") continue;
		const file = item.getAsFile();
		if (!file)
			throw new Error(
				"One or more files are virtual or unavailable. Save them locally, then drop again."
			);
		files.push(file);
		if (files.length > FILE_DROP_MAX_ITEMS) throw new Error("Drop at most 64 files.");
	}
	return files;
}

export function installFileDrop(
	element: HTMLElement,
	pending: (files: File[]) => void,
	hover: (active: boolean) => void,
	error: (message: string) => void = () => {}
): () => void {
	const over = (event: DragEvent) => {
		if (!isFileDrag(event.dataTransfer)) return;
		event.preventDefault();
		event.stopPropagation?.();
		if (event.dataTransfer) event.dataTransfer.dropEffect = "link";
		hover(true);
	};
	const leave = (event: DragEvent) => {
		if (!event.relatedTarget || !element.contains(event.relatedTarget as Node)) hover(false);
	};
	const drop = (event: DragEvent) => {
		if (!isFileDrag(event.dataTransfer)) return;
		event.preventDefault();
		event.stopPropagation();
		hover(false);
		try {
			if (event.dataTransfer) {
				const files = filesFromTransfer(event.dataTransfer);
				if (files.length) pending(files);
				else error("No local files were provided. Save the files locally, then drop again.");
			}
		} catch (cause) {
			error(cause instanceof Error ? cause.message : "Unable to stage files.");
		}
	};
	const listeners = { dragenter: over, dragover: over, dragleave: leave, drop };
	for (const [name, listener] of Object.entries(listeners))
		element.addEventListener(name, listener as EventListener, true);
	return () => {
		for (const [name, listener] of Object.entries(listeners))
			element.removeEventListener(name, listener as EventListener, true);
	};
}
/** Capture the synchronous xterm onData path, never sending twice through ordinary input. */
export function collectFilePaste() {
	let collected: string[] | null = null;
	return {
		capture(data: string): boolean {
			if (!collected) return false;
			collected.push(data);
			return true;
		},
		paste(term: { paste: (text: string) => void }, text: string): string {
			if (collected) throw new Error("A file paste is already in progress.");
			collected = [];
			try {
				term.paste(text);
				const payload = collected.join("");
				if (new TextEncoder().encode(payload).length > FILE_PASTE_MAX_BYTES + 12)
					throw new Error("Paste exceeds limit.");
				return payload;
			} finally {
				collected = null;
			}
		},
	};
}
