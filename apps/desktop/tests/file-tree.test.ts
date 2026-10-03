import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import simpleGit from "simple-git";
import { listAllEntries, listDirectory } from "../src/main/git/file-tree";

let root: string;
const envPaths = [
	".env",
	".env.local",
	".env.development",
	".env.example",
	"nested/.env",
	"ignored-parent/.env",
	".config/settings",
	"info-only",
	"global-only",
];

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "file-browser-"));
	const git = simpleGit(root).env({
		...process.env,
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_CONFIG_NOSYSTEM: "1",
	});
	await git.init();
	await writeFile(join(root, ".gitignore"), ".env*\n!.env.example\nignored-parent/\n");
	await writeFile(join(root, ".git/info/exclude"), "info-only\n");
	await writeFile(join(root, ".git/test-excludes"), "global-only\n");
	await git.addConfig("core.excludesFile", join(root, ".git/test-excludes"));
	for (const path of [...envPaths, "README.md"]) {
		await mkdir(dirname(join(root, path)), { recursive: true });
		await writeFile(join(root, path), "SYNTHETIC_ONLY=fixture\n");
	}
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

test("browser enumeration includes ignored env files and ignored ancestry; legacy stays Git-visible", async () => {
	const legacy = (await listAllEntries(root)).map((e) => e.path);
	expect(legacy).toContain(".env.example");
	expect(legacy).not.toContain(".env");
	expect(legacy).not.toContain("ignored-parent/.env");
	expect(legacy).not.toContain("info-only");
	expect(legacy).not.toContain("global-only");
	const browser = await listAllEntries(root, { mode: "browser" });
	for (const path of envPaths) expect(browser.map((e) => e.path)).toContain(path);
	expect(JSON.stringify(browser)).not.toContain("SYNTHETIC_ONLY");
	expect((await listAllEntries(root)).map((e) => e.path)).toEqual(legacy);
});

test("directory browser mode includes ignored names without changing the default", async () => {
	expect((await listDirectory(root)).map((e) => e.path)).not.toContain(".env");
	expect((await listDirectory(root, "", { mode: "browser" })).map((e) => e.path)).toContain(".env");
	expect(
		(await listDirectory(root, "ignored-parent", { mode: "browser" })).map((e) => e.path)
	).toContain("ignored-parent/.env");
});

test("browser prunes generated directories, Git metadata and special files but lists links without traversing them", async () => {
	const { symlink } = await import("node:fs/promises");
	const excluded = [
		"node_modules",
		"dist",
		"out",
		"build",
		".next",
		".cache",
		"~",
		".turbo",
		"target",
		"coverage",
		"graphify-out",
	];
	for (const name of excluded) {
		await mkdir(join(root, "nested", name));
		await writeFile(join(root, "nested", name, ".env"), "SYNTHETIC_ONLY=excluded");
	}
	await writeFile(join(root, "dist"), "same-named regular file");
	await writeFile(join(root, ".DS_Store"), "noise");
	await writeFile(join(root, "nested/Thumbs.db"), "noise");
	await symlink(join(root, ".env"), join(root, ".env.link"));
	await symlink(root, join(root, "cycle"));
	await symlink(join(root, "absent"), join(root, "broken"));
	await symlink(tmpdir(), join(root, "outside"));
	const fifo = Bun.spawnSync(["mkfifo", join(root, "pipe")]);
	expect(fifo.exitCode).toBe(0);
	const paths = (await listAllEntries(root, { mode: "browser" })).map((e) => e.path);
	for (const name of excluded) expect(paths).not.toContain(`nested/${name}`);
	for (const name of [".git", ".DS_Store", "nested/Thumbs.db", "pipe"])
		expect(paths).not.toContain(name);
	for (const name of [".env.link", "cycle", "broken", "outside"]) {
		expect(await listAllEntries(root, { mode: "browser" })).toContainEqual({
			path: name,
			type: "symlink",
		});
		expect(
			(await listDirectory(root, "", { mode: "browser" })).find((entry) => entry.path === name)
		).toEqual({ name, path: name, type: "symlink" });
		expect(paths.some((path) => path.startsWith(`${name}/`))).toBe(false);
		expect((await listAllEntries(root)).some((entry) => entry.path === name)).toBe(false);
	}
	expect(paths).toContain("dist");
	expect((await listDirectory(root, "nested", { mode: "browser" })).map((e) => e.name)).toEqual([
		".env",
	]);
});

test("browser directory requests cannot traverse links, excluded trees or escape the root", async () => {
	const { symlink } = await import("node:fs/promises");
	await symlink(tmpdir(), join(root, "outside"));
	await mkdir(join(root, "node_modules"));
	for (const path of ["outside", "../", root, ".git", "node_modules"]) {
		await expect(listDirectory(root, path, { mode: "browser" })).rejects.toThrow();
	}
});

test("browser reports unreadable subtrees and missing roots instead of silently truncating", async () => {
	const { chmod } = await import("node:fs/promises");
	await mkdir(join(root, "denied"));
	await chmod(join(root, "denied"), 0);
	try {
		await expect(listAllEntries(root, { mode: "browser" })).rejects.toThrow();
	} finally {
		await chmod(join(root, "denied"), 0o700);
	}
	await expect(listAllEntries(join(root, "absent"), { mode: "browser" })).rejects.toThrow();
	await mkdir(join(root, "empty"));
	expect(await listAllEntries(join(root, "empty"), { mode: "browser" })).toEqual([]);
});

test("browser Git decorations return metadata only, even for tracked env changes", async () => {
	const { getWorkingTreeStatusCached } = await import("../src/main/git/cached-ops");
	const git = simpleGit(root).env({
		...process.env,
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_CONFIG_NOSYSTEM: "1",
	});
	await git.addConfig("user.name", "Fixture");
	await git.addConfig("user.email", "fixture@example.invalid");
	await git.addConfig("commit.gpgsign", "false");
	await git.add([".env.example", "README.md"]);
	await git.commit("fixture");
	await writeFile(join(root, ".env.example"), "SYNTHETIC_ONLY=changed-env\n");
	await writeFile(join(root, "README.md"), "SYNTHETIC_ONLY=changed-normal\n");
	await git.add([".env.example"]);
	const status = await getWorkingTreeStatusCached({ repoPath: root, metadataOnly: true });
	expect(status.stagedFiles.map((file) => file.path)).toContain(".env.example");
	expect(status.unstagedFiles.map((file) => file.path)).toContain("README.md");
	expect(JSON.stringify(status)).not.toContain("SYNTHETIC_ONLY");
	const legacy = await getWorkingTreeStatusCached({ repoPath: root });
	expect(JSON.stringify(legacy)).toContain("SYNTHETIC_ONLY");
});

test("10,000 regular entries are complete and excluded subtrees are never traversed", async () => {
	const { chmod } = await import("node:fs/promises");
	await mkdir(join(root, "node_modules"));
	await chmod(join(root, "node_modules"), 0);
	try {
		for (let folder = 0; folder < 100; folder++) {
			const dir = join(root, `fixture-${folder}`);
			await mkdir(dir);
			await Promise.all(
				Array.from({ length: 100 }, (_, index) =>
					writeFile(join(dir, `.env.${index}`), "synthetic")
				)
			);
		}
		const start = performance.now();
		const entries = await listAllEntries(root, { mode: "browser" });
		expect(
			entries.filter((entry) => entry.type === "file" && entry.path.startsWith("fixture-"))
		).toHaveLength(10_000);
		const elapsed = performance.now() - start;
		console.info(`Browser enumeration: 10,000 fixture files in ${Math.round(elapsed)} ms`);
		expect(elapsed).toBeLessThan(5000);
	} finally {
		await chmod(join(root, "node_modules"), 0o700);
	}
}, 15000);

test("browser decorations do not expand generated untracked subtrees", async () => {
	const { getWorkingTreeStatusCached } = await import("../src/main/git/cached-ops");
	await mkdir(join(root, "node_modules/deep"), { recursive: true });
	await writeFile(join(root, "node_modules/deep/fixture"), "synthetic");
	const status = await getWorkingTreeStatusCached({ repoPath: root, metadataOnly: true });
	expect(status.unstagedFiles.some((file) => file.path.startsWith("node_modules"))).toBe(false);
});

test("legacy enumeration retains its missing-root rejection", async () => {
	await expect(listAllEntries(join(root, "missing"))).rejects.toThrow();
});
