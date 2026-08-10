import { hermesComposerTransferAction } from "./hermes-view-model";

function fileTransferIdentity(file: File): string {
	return JSON.stringify([
		file.name,
		file.size,
		file.type,
		file.lastModified,
		file.webkitRelativePath,
	]);
}

/** Reconciles the two browser views of one transfer without reading either payload. */
export function fileObjectsFromHermesTransfer(transfer: DataTransfer): File[] {
	const files = Array.from(transfer.files);
	const filesByIdentity = new Map<string, number>();
	for (const file of files) {
		const identity = fileTransferIdentity(file);
		filesByIdentity.set(identity, (filesByIdentity.get(identity) ?? 0) + 1);
	}

	const itemOccurrences = new Map<string, number>();
	for (const item of Array.from(transfer.items)) {
		if (item.kind !== "file") continue;
		const file = item.getAsFile();
		if (!file) continue;
		const identity = fileTransferIdentity(file);
		const occurrence = (itemOccurrences.get(identity) ?? 0) + 1;
		itemOccurrences.set(identity, occurrence);
		if (occurrence <= (filesByIdentity.get(identity) ?? 0)) continue;
		files.push(file);
	}
	return files;
}

function isWithinBoundary(boundary: HTMLElement, target: EventTarget | null): boolean {
	if (!target) return false;
	return target === boundary || boundary.contains(target as Node);
}

function isEditablePasteTarget(target: EventTarget | null): boolean {
	if (!target || typeof (target as Element).closest !== "function") return false;
	return Boolean(
		(target as Element).closest('input, textarea, [contenteditable]:not([contenteditable="false"])')
	);
}

export function hermesChatPasteAction(input: {
	activePane: string;
	boundary: HTMLElement;
	target: EventTarget | null;
	composer: HTMLTextAreaElement | null;
	transfer: DataTransfer;
}): "native" | "stage-files" {
	if (
		input.activePane !== "chat" ||
		!isWithinBoundary(input.boundary, input.target) ||
		hermesComposerTransferAction(input.transfer) === "native"
	) {
		return "native";
	}
	if (input.target !== input.composer && isEditablePasteTarget(input.target)) return "native";
	return "stage-files";
}
