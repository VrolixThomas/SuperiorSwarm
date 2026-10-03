import { expect, mock, test } from "bun:test";
import { TerminalFileController } from "../src/renderer/components/terminal-file-controller";
import type { TerminalFileBatch } from "../src/shared/terminal-files";
const batch: TerminalFileBatch = {
	id: "batch",
	target: { terminalId: "term", generation: "g1", workspaceId: "ws", root: "/workspace" },
	entries: [
		{
			id: "a",
			label: "a",
			path: "/workspace/a",
			size: 1,
			kind: "file",
			external: false,
			symlink: false,
			referenceAllowed: true,
			copyAllowed: true,
		},
		{
			id: "b",
			label: "b",
			path: "/workspace/b",
			size: 2,
			kind: "file",
			external: false,
			symlink: false,
			referenceAllowed: true,
			copyAllowed: true,
		},
	],
};
function harness() {
	const writes: string[] = [];
	let active = true;
	const focus = mock(() => {});
	const prepare = mock(async () => structuredClone(batch));
	const resolve = mock(async () => ({
		text: " '/workspace/a' '/workspace/b' ",
		target: batch.target,
	}));
	const insert = mock(async (_id: string, _text: string, payload: string) => {
		writes.push(payload);
		return "admitted" as const;
	});
	const cancel = mock(async () => {});
	const controller = new TerminalFileController(
		{
			prepare,
			resolve,
			insert,
			cancel,
			copy: async () => structuredClone(batch),
			ready: () => active,
			paste: (text) => text,
			focus,
		},
		() => {}
	);
	return {
		controller,
		writes,
		focus,
		prepare,
		resolve,
		insert,
		cancel,
		deactivate: () => {
			active = false;
			controller.clear();
		},
	};
}
test("drop writes/focuses nothing; explicit insert preserves order and is single-use", async () => {
	const h = harness();
	await h.controller.stage(["/native/a", "/native/b"]);
	expect(h.writes).toEqual([]);
	expect(h.focus).not.toHaveBeenCalled();
	await h.controller.insert();
	expect(h.resolve).toHaveBeenCalledWith("batch", ["a", "b"]);
	expect(h.writes).toEqual([" '/workspace/a' '/workspace/b' "]);
	expect(h.focus).toHaveBeenCalledTimes(1);
	await h.controller.insert();
	expect(h.writes).toHaveLength(1);
});
test("stale prepare/resolve after tab switch, replay/disconnect or unmount cannot deliver", async () => {
	const h = harness();
	let finish!: (batch: TerminalFileBatch) => void;
	h.prepare.mockImplementation(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			})
	);
	const stage = h.controller.stage(["/native/a"]);
	h.deactivate();
	finish(batch);
	await stage;
	expect(h.controller.state.batch).toBeNull();
	expect(h.cancel).toHaveBeenCalledWith("batch");
	expect(h.writes).toEqual([]);
	const second = harness();
	await second.controller.stage(["/native/a"]);
	let resolved!: (value: { text: string; target: typeof batch.target }) => void;
	second.resolve.mockImplementation(
		() =>
			new Promise((resolve) => {
				resolved = resolve;
			})
	);
	const inserting = second.controller.insert();
	second.deactivate();
	resolved({ text: " '/a' ", target: batch.target });
	await inserting;
	expect(second.writes).toEqual([]);
	expect(second.focus).not.toHaveBeenCalled();
});
test("remove keeps remaining order; uncertain transport consumes intent without retry", async () => {
	const h = harness();
	await h.controller.stage(["/native/a", "/native/b"]);
	h.controller.remove("a");
	h.insert.mockImplementation(async () => {
		throw new Error("connection lost");
	});
	await h.controller.insert();
	expect(h.resolve).toHaveBeenCalledWith("batch", ["b"]);
	expect(h.controller.state.status).toContain("uncertain");
	await h.controller.insert();
	expect(h.insert).toHaveBeenCalledTimes(1);
});
