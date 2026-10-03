import { afterEach, beforeEach, expect, test } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	symlinkSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TerminalFileOwners, TerminalFileService } from "../src/main/terminal/terminal-files";

let fixture: string;
let root: string;
let owners: TerminalFileOwners;
let service: TerminalFileService;
const caller = { senderId: 10, frameId: 1 };
beforeEach(() => {
	fixture = realpathSync(mkdtempSync(join(tmpdir(), "terminal-files-test-")));
	root = join(fixture, "workspace");
	mkdirSync(root);
	owners = new TerminalFileOwners();
	owners.attach("term", caller, "workspace", root);
	service = new TerminalFileService(owners);
});
afterEach(() => rmSync(fixture, { recursive: true, force: true }));
const file = (name: string, external = false) => {
	const path = join(external ? fixture : root, name);
	writeFileSync(path, "generated fixture");
	return path;
};

test("metadata-only prepare uses canonical targets, keeps arbitrary extensions/order and rejects virtual/special/missing", async () => {
	const paths = [
		file("space name.mov"),
		file("it's 雪.docx"),
		file("-file.zip"),
		file("out.pdf", true),
	];
	const link = join(root, "link");
	symlinkSync(paths[3]!, link);
	const batch = await service.prepare(caller, owners.target("term", caller), [
		...paths,
		link,
		null,
		join(root, "missing"),
	]);
	expect(batch.entries.slice(0, 4).map((e) => e.path)).toEqual(paths);
	expect(batch.entries[3]?.external).toBe(true);
	expect(batch.entries[4]).toMatchObject({ path: paths[3], external: true, symlink: true });
	expect(batch.entries[5]).toMatchObject({ referenceAllowed: false, copyAllowed: false });
	expect(batch.entries[5]?.error).toContain("Save");
	expect(batch.entries[6]?.referenceAllowed).toBe(false);
});
test("unsafe names and ancestors are copy-only, unsafe root cannot become insertable", async () => {
	mkdirSync(join(root, "unsafe\nparent"));
	const batch = await service.prepare(caller, owners.target("term", caller), [
		file("bad\r.mov"),
		file("unsafe\nparent/a.pdf"),
	]);
	expect(batch.entries.every((e) => !e.referenceAllowed && e.copyAllowed)).toBe(true);
	expect(() =>
		service.select(
			caller,
			batch.id,
			batch.entries.map((e) => e.id)
		)
	).toThrow();
});
test("exact sender/frame, terminal, workspace root and generation bind every batch", async () => {
	const target = owners.target("term", caller);
	const batch = await service.prepare(caller, target, [file("a")]);
	expect(() =>
		service.select({ senderId: 11, frameId: 1 }, batch.id, [batch.entries[0]!.id])
	).toThrow();
	expect(() =>
		service.select({ senderId: 10, frameId: 2 }, batch.id, [batch.entries[0]!.id])
	).toThrow();
	owners.attach("term", caller, "other-workspace", root);
	expect(() => service.select(caller, batch.id, [batch.entries[0]!.id])).toThrow();
	await expect(service.prepare(caller, target, [file("b")])).rejects.toThrow();
});
test("tab switch, replay, detach, disconnect, sleep or restart discard intents", async () => {
	for (const reason of [
		"tab switch",
		"replay",
		"detach",
		"disconnect",
		"hibernate",
		"resume",
		"close",
	]) {
		owners.attach("term", caller, "workspace", root);
		const target = owners.target("term", caller);
		const batch = await service.prepare(caller, target, [file("a")]);
		owners.invalidate("term", reason);
		expect(() => service.select(caller, batch.id, [batch.entries[0]!.id])).toThrow();
	}
	const restarted = new TerminalFileService(owners);
	expect(() => restarted.select(caller, "old", [])).toThrow();
});
test("stale async completion and replaced or deleted sources fail closed", async () => {
	const path = file("a");
	const pending = service.prepare(caller, owners.target("term", caller), [path]);
	owners.invalidate("term", "switch");
	await expect(pending).rejects.toThrow();
	const batch = await service.prepare(caller, owners.target("term", caller), [path]);
	unlinkSync(path);
	writeFileSync(path, "replacement");
	await expect(service.resolve(caller, batch.id, [batch.entries[0]!.id])).rejects.toThrow();
});
test("insertion preserves order and consumes intent once even after uncertain delivery", async () => {
	const batch = await service.prepare(caller, owners.target("term", caller), [
		file("a"),
		file("b"),
	]);
	const ready = await service.resolve(
		caller,
		batch.id,
		batch.entries.map((e) => e.id)
	);
	expect(ready.text).toBe(` '${root}/a' '${root}/b' `);
	expect(service.consume(caller, batch.id, ready.text)).toEqual(batch.target);
	expect(() => service.consume(caller, batch.id, ready.text)).toThrow();
});
test("0/64/65 paths, unknown IDs, duplicate selection and expiry are bounded", async () => {
	const path = file("a");
	const target = owners.target("term", caller);
	await expect(service.prepare(caller, target, [])).rejects.toThrow();
	await expect(service.prepare(caller, target, Array(65).fill(path))).rejects.toThrow();
	const batch = await service.prepare(caller, target, Array(64).fill(path));
	expect(batch.entries).toHaveLength(64);
	expect(() => service.select(caller, batch.id, ["forged"])).toThrow();
	expect(() =>
		service.select(caller, batch.id, [batch.entries[0]!.id, batch.entries[0]!.id])
	).toThrow();
});

test("manifest-bound labels contain only display-safe basenames, never source directories", async () => {
	const path = file("private-name.pdf", true);
	const batch = await service.prepare(caller, owners.target("term", caller), [path]);
	expect(batch.entries[0]?.label).toBe("private-name.pdf");
});
test("workspace directory replacement invalidates the bound target", async () => {
	const target = owners.target("term", caller);
	const path = file("a");
	const batch = await service.prepare(caller, target, [path]);
	const { renameSync } = await import("node:fs");
	renameSync(root, `${root}-old`);
	mkdirSync(root);
	expect(() => service.select(caller, batch.id, [batch.entries[0]!.id])).toThrow();
});

test("directories are reference-only; FIFO, socket, broken symlink and deleted paths are unsupported", async () => {
	const { spawnSync } = await import("node:child_process");
	const { createServer } = await import("node:net");
	const fifo = join(root, "fifo");
	expect(spawnSync("mkfifo", [fifo]).status).toBe(0);
	const socketPath = join(root, "socket");
	const server = createServer();
	await new Promise<void>((resolve) => server.listen(socketPath, resolve));
	try {
		const broken = join(root, "broken");
		symlinkSync(join(root, "missing"), broken);
		const deleted = file("deleted");
		unlinkSync(deleted);
		const batch = await service.prepare(caller, owners.target("term", caller), [
			root,
			fifo,
			socketPath,
			broken,
			deleted,
		]);
		expect(batch.entries[0]).toMatchObject({
			kind: "directory",
			referenceAllowed: true,
			copyAllowed: false,
		});
		expect(batch.entries.slice(1).every((e) => !e.referenceAllowed && !e.copyAllowed)).toBe(true);
	} finally {
		server.close();
	}
});

test("renderer navigation invalidates its batches and aborts pending copy work only for that sender", async () => {
	const batch = await service.prepare(caller, owners.target("term", caller), [file("a")]);
	const copying = service.copySource(caller, batch.id, batch.entries[0]!.id);
	owners.invalidateSender(caller.senderId);
	expect(copying.signal.aborted).toBe(true);
	expect(() => service.select(caller, batch.id, [batch.entries[0]!.id])).toThrow();
});

test("invalid Unicode cannot silently resolve to another file via UTF-8 replacement", async () => {
	file("replacement-\ufffd.mov");
	const batch = await service.prepare(caller, owners.target("term", caller), [
		`${root}/replacement-\ud800.mov`,
	]);
	expect(batch.entries[0]).toMatchObject({ referenceAllowed: false, copyAllowed: false });
	expect(batch.entries[0]?.label).toBe("replacement-\\ud800.mov");
});
