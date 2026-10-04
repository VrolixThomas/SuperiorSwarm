import { expect, mock, test } from "bun:test";
import { resolveNativeFiles } from "../src/preload/terminal-files";
import {
	collectFilePaste,
	filesFromTransfer,
	installFileDrop,
} from "../src/renderer/components/terminal-file-drop";

function transfer(files: File[], types = ["Files"]): DataTransfer {
	return {
		types,
		files,
		items: files.map((file) => ({ kind: "file", getAsFile: () => file })),
		getData: () => "file:///forged",
	} as unknown as DataTransfer;
}
function harness() {
	const listeners = new Map<string, (event: DragEvent) => void>();
	const element = {
		addEventListener: (type: string, cb: (e: DragEvent) => void) => listeners.set(type, cb),
		removeEventListener: (type: string) => listeners.delete(type),
		contains: () => false,
	} as unknown as HTMLElement;
	const pending = mock(() => {});
	const hover = mock(() => {});
	const cleanup = installFileDrop(element, pending, hover);
	return { listeners, pending, hover, cleanup };
}
test("registers a terminal-local drop handler; dropping only stages files, prevents navigation and writes zero bytes", () => {
	const h = harness();
	const preventDefault = mock(() => {});
	const stopPropagation = mock(() => {});
	const files = [new File(["generated"], "a.mov"), new File(["fixture"], "b.doc")];
	expect(h.listeners.has("drop")).toBe(true);
	h.listeners.get("drop")?.({
		dataTransfer: transfer(files),
		preventDefault,
		stopPropagation,
	} as unknown as DragEvent);
	expect(h.pending).toHaveBeenCalledWith(files);
	expect(preventDefault).toHaveBeenCalledTimes(1);
	expect(stopPropagation).toHaveBeenCalledTimes(1);
	h.cleanup();
	expect(h.listeners.size).toBe(0);
});
test("internal tab MIME and ordinary text keep their existing handlers", () => {
	for (const types of [
		["text/plain"],
		["text/uri-list"],
		["Files", "application/x-superiorswarm-tab"],
	]) {
		const h = harness();
		const preventDefault = mock(() => {});
		for (const type of ["dragenter", "dragover", "drop"])
			h.listeners.get(type)?.({
				dataTransfer: transfer([], types),
				preventDefault,
			} as unknown as DragEvent);
		expect(preventDefault).not.toHaveBeenCalled();
		expect(h.pending).not.toHaveBeenCalled();
	}
});
test("FileList wins over items, with ordered fallback and 0/64/65 boundaries", () => {
	const file = new File([], "a");
	expect(filesFromTransfer(transfer([file, file]))).toEqual([file, file]);
	const fallback = transfer([file]);
	Object.assign(fallback, { files: [] });
	expect(filesFromTransfer(fallback)).toEqual([file]);
	expect(filesFromTransfer(transfer([]))).toEqual([]);
	expect(filesFromTransfer(transfer(Array(64).fill(file)))).toHaveLength(64);
	expect(() => filesFromTransfer(transfer(Array(65).fill(file)))).toThrow();
});
test("native webUtils is the only path authority; pathless, forged File.path, invalid metadata", () => {
	const file = new File([], "/forged/name", { type: "text/uri-list" });
	Object.assign(file, { path: "/forged/path" });
	expect(resolveNativeFiles([file], () => "")).toEqual([null]);
	expect(resolveNativeFiles([file], () => "/real/native")).toEqual(["/real/native"]);
	expect(
		resolveNativeFiles([file], () => {
			throw new Error("not native");
		})
	).toEqual([null]);
	expect(() =>
		resolveNativeFiles([{ size: Number.NaN, lastModified: 0 } as File], () => "/fake")
	).toThrow();
});
test("one xterm paste preserves draft, captures its input without ordinary PTY writes or Enter", () => {
	let draft = "existing draft";
	const pty: string[] = [];
	const collector = collectFilePaste();
	const onData = (data: string) => {
		if (!collector.capture(data)) pty.push(data);
	};
	const term = {
		paste: (data: string) => {
			draft += data;
			onData(`\x1b[200~${data}\x1b[201~`);
		},
	};
	expect(collector.paste(term, " '/tmp/a' '/tmp/b' ")).toBe(
		"\x1b[200~ '/tmp/a' '/tmp/b' \x1b[201~"
	);
	expect(pty).toEqual([]);
	expect(draft).toBe("existing draft '/tmp/a' '/tmp/b' ");
	onData("ordinary");
	expect(pty).toEqual(["ordinary"]);
});

test("virtual items returning null are reported instead of silently omitting part of a batch", () => {
	const payload = transfer([]);
	Object.assign(payload, {
		items: [
			{ kind: "file", getAsFile: () => new File([], "valid.mov") },
			{ kind: "file", getAsFile: () => null },
		],
	});
	expect(() => filesFromTransfer(payload)).toThrow("Save");
});
