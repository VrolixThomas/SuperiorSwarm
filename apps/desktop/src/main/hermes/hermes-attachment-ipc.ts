import { ipcMain } from "electron";
import type { HermesRendererAttachmentUploadMetadata } from "../../shared/hermes";
import { hermesRendererAttachmentUploads } from "./hermes-attachments";

const cleanupRegistered = new WeakSet<object>();

function rendererOwnerId(senderId: number): string {
	return `renderer:${senderId}`;
}

export function setupHermesAttachmentIPC(): void {
	ipcMain.handle(
		"hermes-attachments:begin",
		(event, attachments: HermesRendererAttachmentUploadMetadata[]) => {
			const ownerId = rendererOwnerId(event.sender.id);
			if (!cleanupRegistered.has(event.sender)) {
				cleanupRegistered.add(event.sender);
				event.sender.once("destroyed", () => {
					hermesRendererAttachmentUploads.cancelOwner(ownerId);
				});
			}
			return hermesRendererAttachmentUploads.begin(ownerId, attachments);
		}
	);
	ipcMain.handle(
		"hermes-attachments:append",
		(event, input: { uploadId: string; fileId: string; offset: number; bytes: Uint8Array }) =>
			hermesRendererAttachmentUploads
				.append(rendererOwnerId(event.sender.id), input)
				.then(() => ({ ok: true as const }))
	);
	ipcMain.handle("hermes-attachments:finish", (event, uploadId: string) =>
		hermesRendererAttachmentUploads.finish(rendererOwnerId(event.sender.id), uploadId)
	);
	ipcMain.handle("hermes-attachments:cancel", (event, uploadId: string) => {
		hermesRendererAttachmentUploads.cancel(rendererOwnerId(event.sender.id), uploadId);
		return { ok: true as const };
	});
}
