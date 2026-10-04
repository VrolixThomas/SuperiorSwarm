import type { FileCaller } from "./terminal-files";
function documentURL(url: string): string {
	try {
		const parsed = new URL(url);
		parsed.hash = "";
		return parsed.href;
	} catch {
		return "";
	}
}
export class RendererTrust {
	private documents = new Map<number, string>();
	register(id: number, url: string): void {
		this.documents.set(id, documentURL(url));
	}
	remove(id: number): void {
		this.documents.delete(id);
	}
	navigationAllowed(id: number, url: string): boolean {
		const expected = this.documents.get(id);
		return Boolean(expected) && documentURL(url) === expected;
	}
	authorize(sender: {
		id: number;
		url: string;
		frameId: number;
		mainFrameId: number;
		destroyed: boolean;
	}): FileCaller {
		if (
			sender.destroyed ||
			sender.frameId !== sender.mainFrameId ||
			!this.navigationAllowed(sender.id, sender.url)
		)
			throw new Error("Terminal files require the application's main frame.");
		return { senderId: sender.id, frameId: sender.frameId };
	}
}
export const rendererTrust = new RendererTrust();
