import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { listAllEntries } from "../src/main/git/file-tree";
import { RepoWatcher } from "../src/main/git/repo-watcher";

let root: string;
let outside: string;
let watcher: RepoWatcher;
beforeEach(async () => {
	root = await realpath(await mkdtemp(join(tmpdir(), "browser-watch-")));
	outside = await realpath(await mkdtemp(join(tmpdir(), "browser-outside-")));
	await simpleGit(root)
		.env({ ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" })
		.init();
	await writeFile(join(root, ".gitignore"), ".env*\nignored/\n");
	await mkdir(join(root, "ignored"));
});
afterEach(async () => {
	await watcher?.close();
	await rm(root, { recursive: true, force: true });
	await rm(outside, { recursive: true, force: true });
});

test("ignored env create/rename/delete events refresh browser names", async () => {
	watcher = new RepoWatcher(root);
	await watcher.start();
	async function change(action: () => Promise<unknown>) {
		const event = new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error("No structural invalidation")), 2000);
			const off = watcher.on(({ kinds }) => {
				if (kinds.includes("working-tree")) {
					clearTimeout(timer);
					off();
					resolve();
				}
			});
		});
		await action();
		await event;
		return (await listAllEntries(root, { mode: "browser" })).map((entry) => entry.path);
	}
	expect(
		await change(() => writeFile(join(root, "ignored/.env"), "SYNTHETIC_ONLY=watch"))
	).toContain("ignored/.env");
	const renamed = await change(() =>
		rename(join(root, "ignored/.env"), join(root, "ignored/.env.local"))
	);
	expect(renamed).not.toContain("ignored/.env");
	expect(renamed).toContain("ignored/.env.local");
	expect(await change(() => rm(join(root, "ignored/.env.local")))).not.toContain(
		"ignored/.env.local"
	);
});

test("watcher never follows a workspace symlink outside the root", async () => {
	await writeFile(join(outside, "note"), "synthetic");
	await symlink(outside, join(root, "linked"));
	watcher = new RepoWatcher(root);
	await watcher.start();
	let events = 0;
	watcher.on(() => events++);
	await writeFile(join(outside, "note"), "changed");
	await new Promise((resolve) => setTimeout(resolve, 600));
	expect(events).toBe(0);
});

test("plain workspace folders still receive structural events without Git metadata", async () => {
	await rm(join(root, ".git"), { recursive: true });
	watcher = new RepoWatcher(root);
	await watcher.start();
	const changed = new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("No plain-folder invalidation")), 2000);
		watcher.on(({ kinds }) => {
			if (kinds.includes("working-tree")) {
				clearTimeout(timer);
				resolve();
			}
		});
	});
	await writeFile(join(root, ".env"), "SYNTHETIC_ONLY=plain");
	await changed;
});

test("watcher exclusions distinguish generated directories from same-named regular files", async () => {
	watcher = new RepoWatcher(root);
	await watcher.start();
	let events = 0;
	watcher.on(() => events++);
	await writeFile(join(root, "dist"), "synthetic regular file");
	await new Promise((resolve) => setTimeout(resolve, 600));
	expect(events).toBeGreaterThan(0);
	events = 0;
	await writeFile(join(root, ".DS_Store"), "noise");
	await new Promise((resolve) => setTimeout(resolve, 600));
	expect(events).toBe(0);
});
