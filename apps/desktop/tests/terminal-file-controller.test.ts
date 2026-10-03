import { expect, mock, test } from "bun:test";
import { TerminalFileController } from "../src/renderer/components/terminal-file-controller";
import type { FileDelivery, TerminalFileBatch } from "../src/shared/terminal-files";
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
	const insert = mock(
		async (_id: string, _text: string, payload: string): Promise<FileDelivery> => {
			writes.push(payload);
			return "admitted" as const;
		}
	);
	const cancel = mock(async () => {});
	const copy = mock(async () => structuredClone(batch));
	const copyPaths = mock(async () => " '/workspace/a' '/workspace/b' ");
	const clipboard = mock(async (_text: string) => {});
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
			copy,
			copyPaths,
			clipboard,
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
		copyPaths,
		clipboard,
		copy,
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

test("legacy insertion-only service adds paths without falsely reporting a send or retrying Enter", async () => {
	const h = harness();
	h.resolve.mockImplementation(async () => ({
		text: " '/workspace/a' ",
		target: batch.target,
		submit: false,
	}));
	await h.controller.stage(["/native/a"]);
	await h.controller.submit();
	expect(h.controller.state.status).toContain("Press Enter again");
	expect(h.controller.state.status).not.toContain("sent with your message");
	expect(h.controller.hasFilesForSubmit()).toBe(false);
	expect(h.insert).toHaveBeenCalledTimes(1);
});

test("suspending for refresh retains file chips but discards live handles and never replays a send", async () => {
	const h = harness();
	await h.controller.stage(["/native/a"]);
	h.controller.suspend("Refreshed");
	expect(h.controller.state.batch?.entries.map((e) => e.id)).toEqual(["a", "b"]);
	expect(h.writes).toEqual([]);
	await h.controller.submit();
	expect(h.prepare).toHaveBeenCalledWith(["/workspace/a", "/workspace/b"]);
	expect(h.insert).toHaveBeenCalledTimes(1);
});
test("restored selection does no input or metadata work until the user's next action", async () => {
	const h = harness();
	h.controller.restore({
		version: 1,
		target: { terminalId: "term", workspaceId: "ws", root: "/workspace" },
		entries: batch.entries.map(({ id, ...entry }) => entry),
	});
	expect(h.prepare).not.toHaveBeenCalled();
	expect(h.resolve).not.toHaveBeenCalled();
	expect(h.writes).toEqual([]);
	await h.controller.submit();
	expect(h.prepare).toHaveBeenCalledTimes(1);
	expect(h.insert).toHaveBeenCalledTimes(1);
});
test("restored references refuse a changed workspace root or file identity", async () => {
	const h = harness();
	h.controller.restore({
		version: 1,
		target: { terminalId: "term", workspaceId: "ws", root: "/different" },
		entries: batch.entries.map(({ id, ...entry }) => entry),
	});
	await h.controller.submit();
	expect(h.insert).not.toHaveBeenCalled();
	expect(h.controller.state.status).toContain("workspace");
});

test("failed preparation can be revalidated on a later user action without an automatic retry", async () => {
	const h = harness();
	await h.controller.stage(["/native/a"]);
	h.resolve.mockImplementationOnce(async () => {
		throw new Error("Pending files expired");
	});
	await h.controller.submit();
	expect(h.insert).not.toHaveBeenCalled();
	expect(h.prepare).toHaveBeenCalledTimes(1);
	await h.controller.submit();
	expect(h.prepare).toHaveBeenCalledTimes(2);
	expect(h.insert).toHaveBeenCalledTimes(1);
});
test("refresh never silently turns a failed or required copy back into an original-path reference", async () => {
	const h = harness();
	h.controller.restore({
		version: 1,
		target: { terminalId: "term", workspaceId: "ws", root: "/workspace" },
		entries: batch.entries.map(({ id, ...entry }) => ({ ...entry, referenceAllowed: false })),
	});
	await h.controller.submit();
	expect(h.insert).not.toHaveBeenCalled();
	expect(h.controller.state.status).toContain("copy");
});

test("a definite rejection keeps selected files for an explicit later attempt", async () => {
	const h = harness();
	await h.controller.stage(["/native/a"]);
	h.insert.mockImplementation(async () => "rejected");
	await h.controller.submit();
	expect(h.controller.state.batch?.entries).toHaveLength(2);
	expect(h.controller.state.status).toContain("Nothing was sent");
	expect(h.insert).toHaveBeenCalledTimes(1);
});
test("a restored file identity mismatch cannot deliver a replacement with the same name", async () => {
	const h = harness();
	h.controller.restore({
		version: 1,
		target: { terminalId: "term", workspaceId: "ws", root: "/workspace" },
		entries: batch.entries.map(({ id, ...entry }) => ({ ...entry, identity: "old-file" })),
	});
	await h.controller.submit();
	expect(h.insert).not.toHaveBeenCalled();
	expect(h.controller.state.status).toContain("changed");
});

test("explicit manual copy validates ordered paths, writes only clipboard, clears send intent and focuses the prompt", async () => {
	const h = harness();
	await h.controller.stage(["/native/a", "/native/b"]);
	expect(h.clipboard).not.toHaveBeenCalled();
	await h.controller.copyPaths();
	expect(h.copyPaths).toHaveBeenCalledWith("batch", ["a", "b"]);
	expect(h.clipboard).toHaveBeenCalledWith(" '/workspace/a' '/workspace/b' ");
	expect(h.writes).toEqual([]);
	expect(h.resolve).not.toHaveBeenCalled();
	expect(h.controller.state.batch).toBeNull();
	expect(h.controller.state.status).toContain("Paste into the prompt");
	expect(h.focus).toHaveBeenCalledTimes(1);
});
test("manual clipboard failure keeps files; stale validation cannot write clipboard or refocus", async () => {
	const h = harness();
	await h.controller.stage(["/native/a"]);
	h.clipboard.mockImplementation(async () => {
		throw new Error("Clipboard unavailable");
	});
	await h.controller.copyPaths();
	expect(h.controller.state.batch?.entries).toHaveLength(2);
	expect(h.controller.state.status).toContain("Clipboard unavailable");
	let finish!: (value: string) => void;
	h.copyPaths.mockImplementation(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			})
	);
	const operation = h.controller.copyPaths();
	h.deactivate();
	finish(" '/workspace/a' ");
	await operation;
	expect(h.clipboard).toHaveBeenCalledTimes(1);
	expect(h.focus).not.toHaveBeenCalled();
	expect(h.writes).toEqual([]);
});

test("service-update guidance appears as files are added and survives tab suspension", async () => {
	const h = harness();
	h.prepare.mockImplementation(async () => ({
		...structuredClone(batch),
		inputAvailability: "update-required",
	}));
	await h.controller.stage(["/native/a"]);
	expect(h.controller.state.status).toContain("restart SuperiorSwarm");
	h.controller.suspend();
	expect(h.controller.state.status).toContain("restart SuperiorSwarm");
	expect(h.controller.state.batch?.entries).toHaveLength(2);
	expect(h.writes).toEqual([]);
});

test("workspace copy does not replace an unavailable-service diagnosis with a promise to send", async () => {
	const h = harness();
	const unavailable: TerminalFileBatch = {
		...structuredClone(batch),
		inputAvailability: "update-required",
	};
	h.prepare.mockImplementation(async () => unavailable);
	h.copy.mockImplementation(async () => unavailable);
	await h.controller.stage(["/native/a"]);
	await h.controller.copy("a");
	expect(h.controller.state.status).toContain("restart SuperiorSwarm");
	expect(h.writes).toEqual([]);
});
