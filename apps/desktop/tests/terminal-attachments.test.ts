import { afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
	chmodSync,
	closeSync,
	ftruncateSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	readFileSync,
	readdirSync,
	realpathSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { TerminalAttachmentStore } from "../src/main/terminal/terminal-attachments";
import { snapshotFile } from "../src/main/terminal/terminal-files";
let fixtures: string;
let root: string;
let local: string;
let helper: string;
let store: TerminalAttachmentStore;
let buildDir: string;
beforeAll(() => {
	buildDir = mkdtempSync(join(tmpdir(), "terminal-copy-build-"));
	helper = join(buildDir, "terminal-file-copy");
	const result = spawnSync("cc", [
		"-std=c11",
		"-Wall",
		"-Wextra",
		"-Werror",
		"-O2",
		resolve("apps/desktop/src/main/terminal/terminal-file-copy.c"),
		"-o",
		helper,
	]);
	if (result.status !== 0) throw new Error(result.stderr.toString());
});
import { afterAll } from "bun:test";
afterAll(() => {
	if (buildDir) rmSync(buildDir, { recursive: true, force: true });
});
beforeEach(() => {
	fixtures = realpathSync(mkdtempSync(join(tmpdir(), "terminal-copy-test-")));
	root = join(fixtures, "workspace");
	local = join(fixtures, "local");
	mkdirSync(root);
	mkdirSync(local);
	store = new TerminalAttachmentStore(local, helper);
});
afterEach(() => {
	if (fixtures) rmSync(fixtures, { recursive: true, force: true });
});
const source = (name = "name\n'雪.mov", bytes = "generated fixture") => {
	const path = join(fixtures, name);
	writeFileSync(path, bytes);
	return path;
};
const copy = async (path: string, signal = new AbortController().signal) =>
	store.copy("workspace", root, await snapshotFile(path), "original label", signal);

test("explicit copy uses generated ASCII storage, preserves bytes, permissions and originals, persists without source paths", async () => {
	const path = source();
	const result = await copy(path);
	expect(result.path).toMatch(/\.superiorswarm\/attachments\/[a-f0-9-]+\/file$/);
	expect(readFileSync(result.path, "utf8")).toBe("generated fixture");
	expect(readFileSync(path, "utf8")).toBe("generated fixture");
	expect(statSync(result.path).mode & 0o777).toBe(0o600);
	expect(statSync(join(result.path, "..")).mode & 0o777).toBe(0o700);
	const restart = new TerminalAttachmentStore(local, helper);
	expect(await restart.list("workspace", root)).toEqual([result]);
	const manifest = readFileSync(join(local, "terminal-attachments.json"), "utf8");
	expect(manifest).not.toContain(path);
	await restart.delete("workspace", root, result.id);
	expect(await restart.list("workspace", root)).toEqual([]);
	expect(readFileSync(path, "utf8")).toBe("generated fixture");
});
test("external symlink target, duplicate names and copies never overwrite", async () => {
	const path = source("same.pdf");
	const link = join(root, "link");
	symlinkSync(path, link);
	const a = await copy(link);
	const b = await copy(path);
	expect(a.path).not.toBe(b.path);
	expect(readFileSync(a.path)).toEqual(readFileSync(b.path));
});
test("destination symlinks cannot escape containment, deletion never follows replacements", async () => {
	mkdirSync(join(root, ".superiorswarm"));
	symlinkSync(fixtures, join(root, ".superiorswarm", "attachments"));
	await expect(copy(source())).rejects.toThrow();
	expect(readdirSync(fixtures).sort()).toEqual(["local", "name\n'雪.mov", "workspace"]);
	rmSync(join(root, ".superiorswarm"), { recursive: true });
	const result = await copy(source());
	rmSync(join(result.path, ".."), { recursive: true });
	symlinkSync(fixtures, join(result.path, ".."));
	await expect(store.delete("workspace", root, result.id)).rejects.toThrow();
	expect(readFileSync(source(), "utf8")).toBe("generated fixture");
});
test("cancel, quota, read-only and source replacement fail without partial publication", async () => {
	const path = source();
	const controller = new AbortController();
	controller.abort();
	await expect(copy(path, controller.signal)).rejects.toThrow();
	const large = source("large.mov");
	const fd = openSync(large, "r+");
	ftruncateSync(fd, 2 * 1024 ** 3 + 1);
	closeSync(fd);
	await expect(copy(large)).rejects.toThrow("2 GiB");
	const snapshot = await snapshotFile(path);
	rmSync(path);
	writeFileSync(path, "changed");
	await expect(
		store.copy("workspace", root, snapshot, "label", new AbortController().signal)
	).rejects.toThrow();
	chmodSync(root, 0o500);
	try {
		await expect(copy(path)).rejects.toThrow();
	} finally {
		chmodSync(root, 0o700);
	}
});
test("large files stream, report progress, and can be cancelled mid-copy", async () => {
	const path = source("large.bin");
	const fd = openSync(path, "r+");
	ftruncateSync(fd, 64 * 1024 ** 2);
	closeSync(fd);
	let progress = 0;
	const result = await store.copy(
		"workspace",
		root,
		await snapshotFile(path),
		"large",
		new AbortController().signal,
		(n) => {
			progress = n;
		}
	);
	expect(progress).toBe(64 * 1024 ** 2);
	expect(statSync(result.path).size).toBe(progress);
	const cancel = new AbortController();
	await expect(
		store.copy("workspace", root, await snapshotFile(path), "large", cancel.signal, () =>
			cancel.abort()
		)
	).rejects.toThrow();
	expect(await store.list("workspace", root)).toHaveLength(1);
});
test("Git worktree excludes are upgraded idempotently, failure blocks copy", async () => {
	const repo = join(fixtures, "repo");
	mkdirSync(repo);
	expect(spawnSync("git", ["init", repo]).status).toBe(0);
	writeFileSync(
		join(repo, ".git/info/exclude"),
		"# superiorswarm: ignore MCP config strays\n.mcp.json\n"
	);
	// Generated worktree metadata avoids commits and global Git configuration.
	const metadata = join(repo, ".git/worktrees/fixture");
	mkdirSync(metadata, { recursive: true });
	writeFileSync(join(metadata, "commondir"), "../..\n");
	writeFileSync(join(root, ".git"), `gitdir: ${metadata}\n`);
	await copy(source());
	await copy(source());
	const exclude = readFileSync(join(repo, ".git/info/exclude"), "utf8");
	expect(exclude.split("/.superiorswarm/attachments/")).toHaveLength(2);
	chmodSync(join(repo, ".git/info/exclude"), 0o400);
	// Existing exact exclusion requires no write.
	await copy(source());
});

test("retained byte quota is shared by workspace aliases pointing at the same root", async () => {
	await copy(source());
	const manifestPath = join(local, "terminal-attachments.json");
	const records = JSON.parse(readFileSync(manifestPath, "utf8"));
	records[0].size = 4 * 1024 ** 3;
	writeFileSync(manifestPath, JSON.stringify(records));
	await expect(
		store.copy(
			"other-workspace",
			root,
			await snapshotFile(source()),
			"label",
			new AbortController().signal
		)
	).rejects.toThrow("quota");
});
test("an app-owned partial record with no published file can be explicitly cleared after restart", async () => {
	const result = await copy(source());
	rmSync(join(result.path, ".."), { recursive: true });
	const restarted = new TerminalAttachmentStore(local, helper);
	await restarted.delete("workspace", root, result.id);
	expect(await restarted.list("workspace", root)).toEqual([]);
});

test("source deletion/replacement during streaming rejects publication", async () => {
	for (const replace of [false, true]) {
		const path = source("race.mov");
		const fd = openSync(path, "r+");
		ftruncateSync(fd, 64 * 1024 ** 2);
		closeSync(fd);
		const snapshot = await snapshotFile(path);
		let changed = false;
		await expect(
			store.copy("workspace", root, snapshot, "race", new AbortController().signal, () => {
				if (changed) return;
				changed = true;
				rmSync(path);
				if (replace) writeFileSync(path, "replacement");
			})
		).rejects.toThrow();
		expect(await store.list("workspace", root)).toHaveLength(0);
	}
});
test("destination ancestor swap during streaming cannot publish through a moved directory or symlink", async () => {
	const path = source("race.mov");
	const fd = openSync(path, "r+");
	ftruncateSync(fd, 128 * 1024 ** 2);
	closeSync(fd);
	const { renameSync } = await import("node:fs");
	let moved = false;
	const outside = join(fixtures, "outside");
	mkdirSync(outside);
	await expect(
		store.copy(
			"workspace",
			root,
			await snapshotFile(path),
			"race",
			new AbortController().signal,
			() => {
				if (moved) return;
				moved = true;
				renameSync(join(root, ".superiorswarm/attachments"), join(fixtures, "moved"));
				symlinkSync(outside, join(root, ".superiorswarm/attachments"));
			}
		)
	).rejects.toThrow();
	expect(readdirSync(outside)).toEqual([]);
	expect(await store.list("workspace", root)).toHaveLength(1);
	for (const id of readdirSync(join(fixtures, "moved"))) {
		expect(readdirSync(join(fixtures, "moved", id))).not.toContain("file");
	}
});
test("Git exclude symlinks fail closed and never alter the link target", async () => {
	mkdirSync(join(root, ".git/info"), { recursive: true });
	const sentinel = source("sentinel", "untouched");
	symlinkSync(sentinel, join(root, ".git/info/exclude"));
	await expect(copy(source())).rejects.toThrow();
	expect(readFileSync(sentinel, "utf8")).toBe("untouched");
});

test("Git exclusion uses descriptor-relative native writes and rejects a FIFO without blocking", () => {
	const git = join(root, ".git");
	mkdirSync(join(git, "info"), { recursive: true });
	const st = statSync(git);
	const id = "12345678-1234-1234-1234-123456789abc";
	const args = ["exclude", git, id, String(st.dev), String(st.ino), "0"];
	expect(spawnSync(helper, args, { timeout: 1000 }).status).toBe(0);
	expect(readFileSync(join(git, "info/exclude"), "utf8")).toContain("/.superiorswarm/attachments/");
	rmSync(join(git, "info/exclude"));
	expect(spawnSync("mkfifo", [join(git, "info/exclude")]).status).toBe(0);
	const result = spawnSync(helper, args, { timeout: 1000 });
	expect(result.error).toBeUndefined();
	expect(result.status).not.toBe(0);
});

test("generated filesystem write failure reports an error and cleans partial bytes", async () => {
	const wrapperSource = join(fixtures, "limited-copy.c");
	const wrapper = join(fixtures, "limited-copy");
	writeFileSync(
		wrapperSource,
		`#include <sys/resource.h>\n#include <unistd.h>\nint main(int argc, char **argv) { (void)argc; struct rlimit limit = {4096,4096}; if(setrlimit(RLIMIT_FSIZE,&limit)) return 9; argv[0] = ${JSON.stringify(helper)}; execv(argv[0],argv); return 10; }\n`
	);
	expect(spawnSync("cc", [wrapperSource, "-o", wrapper]).status).toBe(0);
	const path = source("disk-failure.bin");
	const fd = openSync(path, "r+");
	ftruncateSync(fd, 1024 * 1024);
	closeSync(fd);
	const limited = new TerminalAttachmentStore(local, wrapper);
	await expect(
		limited.copy(
			"workspace",
			root,
			await snapshotFile(path),
			"disk failure",
			new AbortController().signal
		)
	).rejects.toThrow();
	expect(await limited.list("workspace", root)).toEqual([]);
	expect(statSync(path).size).toBe(1024 * 1024);
});

test("copy fallback rejects a workspace whose own path contains terminal controls with actionable guidance", async () => {
	const unsafeRoot = join(fixtures, "workspace\nunsafe");
	mkdirSync(unsafeRoot);
	await expect(
		store.copy(
			"unsafe",
			unsafeRoot,
			await snapshotFile(source()),
			"label",
			new AbortController().signal
		)
	).rejects.toThrow("safe path");
	expect(readdirSync(unsafeRoot)).toEqual([]);
});

test("queued attachment operations have a hard admission bound", async () => {
	const snapshot = await snapshotFile(source());
	const cancel = new AbortController();
	cancel.abort();
	const requests = Array.from({ length: 65 }, () =>
		store.copy("workspace", root, snapshot, "label", cancel.signal)
	);
	const results = await Promise.allSettled(requests);
	expect(results[64]?.status === "rejected" ? String(results[64].reason) : "").toContain(
		"Too many attachment operations"
	);
});

test("manifest publication failure cleans exclusively-created temporary metadata", async () => {
	const path = source("manifest-failure.bin");
	const fd = openSync(path, "r+");
	ftruncateSync(fd, 1024 * 1024);
	closeSync(fd);
	let changed = false;
	await expect(
		store.copy(
			"workspace",
			root,
			await snapshotFile(path),
			"label",
			new AbortController().signal,
			() => {
				if (changed) return;
				changed = true;
				rmSync(join(local, "terminal-attachments.json"));
				mkdirSync(join(local, "terminal-attachments.json"));
			}
		)
	).rejects.toThrow();
	expect(readdirSync(local)).toEqual(["terminal-attachments.json"]);
});

test("Git worktree pointer parsing preserves spaces in the complete metadata path", async () => {
	const repo = join(fixtures, "repo");
	mkdirSync(repo);
	expect(spawnSync("git", ["init", repo]).status).toBe(0);
	const metadata = join(repo, ".git/worktrees/trailing space ");
	mkdirSync(metadata, { recursive: true });
	writeFileSync(join(metadata, "commondir"), "../..\n");
	writeFileSync(join(root, ".git"), `gitdir: ${metadata}\n`);
	await copy(source());
	expect(readFileSync(join(repo, ".git/info/exclude"), "utf8")).toContain(
		"/.superiorswarm/attachments/"
	);
});
