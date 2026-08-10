import { hermesComposerTransferAction } from "./hermes-view-model";

/**
 * DataTransfer exposes the same physical payload through `files` and `items`.
 * Chromium may assign different metadata to those wrappers, so never merge the
 * two views. The FileList is authoritative; file items are a fallback for
 * clipboard producers that leave it empty.
 */
export function fileObjectsFromHermesTransfer(transfer: DataTransfer): File[] {
	const files = Array.from(transfer.files);
	if (files.length > 0) return files;

	const fallback: File[] = [];
	for (const item of Array.from(transfer.items)) {
		if (item.kind !== "file") continue;
		const file = item.getAsFile();
		if (file) fallback.push(file);
	}
	return fallback;
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
