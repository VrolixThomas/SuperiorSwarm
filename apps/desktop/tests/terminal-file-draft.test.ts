import { expect, test } from "bun:test";
import { TerminalFileDraftStore } from "../src/renderer/components/terminal-file-draft";
import type { TerminalFileBatch } from "../src/shared/terminal-files";
function storage() {
	const data = new Map<string, string>();
	return {
		data,
		getItem: (key: string) => data.get(key) ?? null,
		setItem: (key: string, value: string) => {
			data.set(key, value);
		},
		removeItem: (key: string) => {
			data.delete(key);
		},
	};
}
const batch: TerminalFileBatch = {
	id: "never-save-batch-token",
	target: {
		terminalId: "t1",
		workspaceId: "ws",
		root: "/fixture",
		generation: "never-save-session-token",
	},
	entries: [
		{
			id: "ephemeral-entry",
			label: "document.pdf",
			path: "/fixture/document.pdf",
			kind: "file",
			size: 10,
			external: false,
			symlink: false,
			referenceAllowed: true,
			copyAllowed: true,
		},
	],
};
test("refresh stores selected file metadata without a batch, generation, payload or send request", () => {
	const cache = storage();
	const first = new TerminalFileDraftStore(cache, "ws", "t1");
	expect(first.save(batch)).toBe(true);
	const json = Array.from(cache.data.values()).join("");
	expect(json).not.toContain("never-save");
	expect(json).not.toContain("ephemeral-entry");
	expect(json).not.toContain("submit");
	const restored = new TerminalFileDraftStore(cache, "ws", "t1").load();
	expect(restored?.entries[0]?.path).toBe("/fixture/document.pdf");
	expect(new TerminalFileDraftStore(cache, "other-workspace", "t1").load()).toBeNull();
	expect(new TerminalFileDraftStore(cache, "ws", "t2").load()).toBeNull();
	first.save(null);
	expect(first.load()).toBeNull();
});
test("malformed or oversized saved selections are ignored and writes never fall back to stale data", () => {
	const cache = storage();
	const draft = new TerminalFileDraftStore(cache, "ws", "t1");
	draft.save(batch);
	const key = Array.from(cache.data.keys())[0]!;
	cache.data.set(key, "{broken");
	expect(draft.load()).toBeNull();
	cache.data.set(
		key,
		JSON.stringify({
			version: 1,
			target: { terminalId: "t1", workspaceId: "ws", root: "/fixture" },
			entries: Array(65).fill(batch.entries[0]),
		})
	);
	expect(draft.load()).toBeNull();
	draft.save(batch);
	cache.setItem = () => {
		throw new Error("quota");
	};
	expect(draft.save({ ...batch, entries: [{ ...batch.entries[0]!, label: "changed.pdf" }] })).toBe(
		false
	);
	expect(draft.load()).toBeNull();
});
