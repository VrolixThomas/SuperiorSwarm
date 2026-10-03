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
	const append = mock(async (_id: string, _paths: Array<string | null>, ids: string[]) => ({
		...structuredClone(batch),
		entries: [
			...batch.entries.filter((e) => ids.includes(e.id)),
			{ ...batch.entries[0]!, id: "c", label: "c", path: "/workspace/c" },
		],
	}));
	const controller = new TerminalFileController(
		{
			prepare,
			append,
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
		append,
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

test("successive drops append, keeping earlier selections and removals", async () => {
	const h = harness();
	await h.controller.stage(["/native/a", "/native/b"]);
	h.controller.remove("b");
	await h.controller.stage(["/native/c"]);
	expect(h.prepare).toHaveBeenCalledTimes(1);
	expect(h.append).toHaveBeenCalledWith("batch", ["/native/c"], ["a"]);
	expect(h.controller.state.batch?.entries.map((e) => e.id)).toEqual(["a", "c"]);
	expect(h.writes).toEqual([]);
	expect(h.focus).not.toHaveBeenCalled();
	expect(h.cancel).not.toHaveBeenCalled();
});
test("rapid consecutive drops are serialized without losing the first preparation", async () => {
	const h = harness();
	let finish!: (value: TerminalFileBatch) => void;
	h.prepare.mockImplementation(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			})
	);
	const first = h.controller.stage(["/native/a"]);
	const second = h.controller.stage(["/native/c"]);
	expect(h.append).not.toHaveBeenCalled();
	finish(structuredClone(batch));
	await first;
	await second;
	expect(h.prepare).toHaveBeenCalledTimes(1);
	expect(h.append).toHaveBeenCalledTimes(1);
	expect(h.controller.state.batch?.entries.map((e) => e.id)).toEqual(["a", "b", "c"]);
});
test("cancelled picker and failed additional drop preserve earlier files", async () => {
	const h = harness();
	await h.controller.stage(["/native/a"]);
	await h.controller.stage([]);
	expect(h.controller.state.batch?.entries).toHaveLength(2);
	h.append.mockImplementation(async () => {
		throw new Error("Cannot add file");
	});
	await h.controller.stage(["/native/c"]);
	expect(h.controller.state.batch?.entries.map((e) => e.id)).toEqual(["a", "b"]);
	expect(h.controller.state.status).toContain("Cannot add file");
	expect(h.cancel).not.toHaveBeenCalled();
});
test("explicit Enter sends paths with that message once; dropping alone does not paste or submit", async () => {
	const h = harness();
	await h.controller.stage(["/native/a"]);
	expect(h.insert).not.toHaveBeenCalled();
	await h.controller.submit();
	expect(h.insert).toHaveBeenCalledWith(
		"batch",
		" '/workspace/a' '/workspace/b' ",
		" '/workspace/a' '/workspace/b' ",
		true
	);
	expect(h.controller.state.batch).toBeNull();
	await h.controller.submit();
	expect(h.insert).toHaveBeenCalledTimes(1);
});
test("Enter during file resolution cannot send the text alone or submit automatically later", async () => {
	const h = harness();
	let finish!: (value: TerminalFileBatch) => void;
	h.prepare.mockImplementation(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			})
	);
	const staging = h.controller.stage(["/native/a"]);
	expect(h.controller.hasFilesForSubmit()).toBe(true);
	await h.controller.submit();
	expect(h.insert).not.toHaveBeenCalled();
	finish(structuredClone(batch));
	await staging;
	expect(h.insert).not.toHaveBeenCalled();
});
