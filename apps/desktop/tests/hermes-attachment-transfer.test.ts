import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import {
	fileObjectsFromHermesTransfer,
	hermesChatPasteAction,
} from "../src/renderer/hermes/hermes-attachment-transfer";

const testWindow = new Window({ url: "http://localhost" });

function file(name: string, contents: string, lastModified = 123): File {
	return new testWindow.File([contents], name, {
		type: "image/png",
		lastModified,
	}) as unknown as File;
}

function transfer(files: File[], itemFiles: File[], types: string[] = ["Files"]): DataTransfer {
	return {
		files: files as unknown as FileList,
		items: itemFiles.map((itemFile) => ({
			kind: "file",
			type: itemFile.type,
			getAsFile: () => itemFile,
		})) as unknown as DataTransferItemList,
		types,
	} as unknown as DataTransfer;
}

describe("Hermes attachment transfers", () => {
	test("deduplicates distinct File wrappers for one physical clipboard payload", () => {
		const filesWrapper = file("screen.png", "same bytes");
		const itemsWrapper = file("screen.png", "same bytes");

		expect(fileObjectsFromHermesTransfer(transfer([filesWrapper], [itemsWrapper]))).toEqual([
			filesWrapper,
		]);
	});

	test("preserves two legitimate same-name files from one transfer", () => {
		const first = file("screen.png", "same bytes");
		const second = file("screen.png", "same bytes");
		const firstItemsWrapper = file("screen.png", "same bytes");
		const secondItemsWrapper = file("screen.png", "same bytes");

		expect(
			fileObjectsFromHermesTransfer(
				transfer([first, second], [firstItemsWrapper, secondItemsWrapper])
			)
		).toEqual([first, second]);
	});

	test("attaches file paste from non-editable chat UI and the composer textarea", () => {
		const boundary = testWindow.document.createElement("main");
		const transcript = testWindow.document.createElement("div");
		const composer = testWindow.document.createElement("textarea");
		boundary.append(transcript, composer);
		const clipboard = transfer([file("screen.png", "bytes")], []);

		expect(
			hermesChatPasteAction({
				activePane: "chat",
				boundary: boundary as unknown as HTMLElement,
				target: transcript as unknown as EventTarget,
				composer: composer as unknown as HTMLTextAreaElement,
				transfer: clipboard,
			})
		).toBe("stage-files");
		expect(
			hermesChatPasteAction({
				activePane: "chat",
				boundary: boundary as unknown as HTMLElement,
				target: composer as unknown as EventTarget,
				composer: composer as unknown as HTMLTextAreaElement,
				transfer: clipboard,
			})
		).toBe("stage-files");
		expect(testWindow.document.activeElement).not.toBe(composer);
	});

	test("leaves other editable targets and non-Hermes surfaces native", () => {
		const boundary = testWindow.document.createElement("main");
		const composer = testWindow.document.createElement("textarea");
		const input = testWindow.document.createElement("input");
		const editable = testWindow.document.createElement("div");
		const outside = testWindow.document.createElement("div");
		editable.setAttribute("contenteditable", "true");
		boundary.append(composer, input, editable);
		const clipboard = transfer([file("screen.png", "bytes")], []);

		for (const target of [input, editable, outside]) {
			expect(
				hermesChatPasteAction({
					activePane: "chat",
					boundary: boundary as unknown as HTMLElement,
					target: target as unknown as EventTarget,
					composer: composer as unknown as HTMLTextAreaElement,
					transfer: clipboard,
				})
			).toBe("native");
		}
		expect(
			hermesChatPasteAction({
				activePane: "worktrees",
				boundary: boundary as unknown as HTMLElement,
				target: composer as unknown as EventTarget,
				composer: composer as unknown as HTMLTextAreaElement,
				transfer: clipboard,
			})
		).toBe("native");
	});

	test("leaves text-only paste native without moving focus", () => {
		const boundary = testWindow.document.createElement("main");
		const transcript = testWindow.document.createElement("div");
		const composer = testWindow.document.createElement("textarea");
		boundary.append(transcript, composer);

		expect(
			hermesChatPasteAction({
				activePane: "chat",
				boundary: boundary as unknown as HTMLElement,
				target: transcript as unknown as EventTarget,
				composer: composer as unknown as HTMLTextAreaElement,
				transfer: transfer([], [], ["text/plain"]),
			})
		).toBe("native");
		expect(testWindow.document.activeElement).not.toBe(composer);
	});
});
