import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _setDbForTesting, schema } from "../src/main/db";
import { t } from "../src/main/trpc";
import { diffRouter } from "../src/main/trpc/routers/diff";
import { makeTestDb } from "./test-db";

let root: string;
let a: string;
let b: string;
const caller = t.createCallerFactory(diffRouter)({});
beforeEach(async () => {
	root = await realpath(await mkdtemp(join(tmpdir(), "browser-paths-")));
	a = join(root, "main");
	b = join(root, "worktree");
	await mkdir(a);
	await mkdir(b);
	await writeFile(join(a, ".env"), "SYNTHETIC_ONLY=main\n");
	await writeFile(join(b, ".env"), "SYNTHETIC_ONLY=worktree\n");
	const db = makeTestDb();
	_setDbForTesting(db);
	const now = new Date();
	db.insert(schema.projects)
		.values({
			id: "p",
			name: "fixture",
			repoPath: a,
			defaultBranch: "main",
			createdAt: now,
			updatedAt: now,
		})
		.run();
	db.insert(schema.worktrees)
		.values({
			id: "wt",
			projectId: "p",
			path: b,
			branch: "fixture",
			baseBranch: "main",
			createdAt: now,
			updatedAt: now,
		})
		.run();
	db.insert(schema.workspaces)
		.values([
			{ id: "a", projectId: "p", name: "main", type: "branch", createdAt: now, updatedAt: now },
			{
				id: "b",
				projectId: "p",
				name: "worktree",
				type: "worktree",
				worktreeId: "wt",
				createdAt: now,
				updatedAt: now,
			},
			{
				id: "folder",
				projectId: "p",
				name: "plain folder",
				type: "folder",
				folderPath: b,
				createdAt: now,
				updatedAt: now,
			},
		])
		.run();
});
afterEach(async () => {
	_setDbForTesting(null);
	await rm(root, { recursive: true, force: true });
});

test("editor reads/saves the registered workspace root and rejects another checkout", async () => {
	expect(
		(await caller.getFileContent({ workspaceId: "b", repoPath: b, filePath: ".env", ref: "" }))
			.content
	).toBe("SYNTHETIC_ONLY=worktree\n");
	await expect(
		caller.getFileContent({ workspaceId: "b", repoPath: a, filePath: ".env", ref: "" })
	).rejects.toThrow();
	await expect(
		caller.saveFileContent({ workspaceId: "b", repoPath: a, filePath: ".env", content: "wrong" })
	).rejects.toThrow();
	await caller.saveFileContent({
		workspaceId: "b",
		repoPath: b,
		filePath: ".env",
		content: "SYNTHETIC_ONLY=edited\n",
	});
	expect(await readFile(join(a, ".env"), "utf8")).toBe("SYNTHETIC_ONLY=main\n");
	expect(await readFile(join(b, ".env"), "utf8")).toBe("SYNTHETIC_ONLY=edited\n");
});

test("browser enumeration requires matching workspace registration; plain folders and root aliases work", async () => {
	await expect(
		caller.listAllFiles({ workspaceId: "b", repoPath: a, mode: "browser" })
	).rejects.toThrow();
	await expect(caller.listAllFiles({ repoPath: a, mode: "browser" })).rejects.toThrow();
	await expect(
		caller.listDirectory({ workspaceId: "missing", repoPath: a, mode: "browser" })
	).rejects.toThrow();
	await symlink(b, join(root, "alias"));
	expect(
		(
			await caller.listAllFiles({
				workspaceId: "folder",
				repoPath: join(root, "alias"),
				mode: "browser",
			})
		).entries
	).toContainEqual({ path: ".env", type: "file" });
	// Legacy callers keep their existing contract.
	expect((await caller.listAllFiles({ repoPath: a })).entries).toContainEqual({
		path: ".env",
		type: "file",
	});
});

test("scoped editor routes reject linked parents, special files and escaping/root paths", async () => {
	await symlink(a, join(b, "link"));
	await symlink(join(a, ".env"), join(b, ".env.link"));
	for (const filePath of ["link/.env", "../main/.env", join(b, ".env"), "", "."]) {
		await expect(
			caller.getFileContent({ workspaceId: "b", repoPath: b, filePath, ref: "" })
		).rejects.toThrow();
		await expect(
			caller.saveFileContent({ workspaceId: "b", repoPath: b, filePath, content: "wrong" })
		).rejects.toThrow();
	}
	await expect(
		caller.getFileContent({ workspaceId: "b", repoPath: b, filePath: "missing", ref: "" })
	).rejects.toThrow();
	await caller.saveFileContent({
		workspaceId: "b",
		repoPath: b,
		filePath: "nested/é space/.env",
		content: "",
	});
	expect(await readFile(join(b, "nested/é space/.env"), "utf8")).toBe("");
});

test("browser create/rename/delete cannot mutate another workspace or a linked parent", async () => {
	await symlink(a, join(b, "link"));
	await expect(
		caller.createFile({ workspaceId: "b", repoPath: a, filePath: "new" })
	).rejects.toThrow();
	await expect(
		caller.createFolder({ workspaceId: "b", repoPath: b, dirPath: "link/new" })
	).rejects.toThrow();
	await expect(
		caller.renameFileOrFolder({
			workspaceId: "b",
			repoPath: b,
			oldPath: ".env",
			newPath: "link/renamed",
		})
	).rejects.toThrow();
	await expect(
		caller.deleteFileOrFolder({ workspaceId: "b", repoPath: b, targetPath: "." })
	).rejects.toThrow();
});

test("explicit editor opens file links and saves to the opened target while preserving the link", async () => {
	const { lstat } = await import("node:fs/promises");
	await symlink(join(a, ".env"), join(b, ".env.link"));
	const opened = await caller.getFileContent({
		workspaceId: "b",
		repoPath: b,
		filePath: ".env.link",
		ref: "",
	});
	expect(opened.content).toBe("SYNTHETIC_ONLY=main\n");
	expect(opened.symlinkTarget).toBe(join(a, ".env"));
	await caller.saveFileContent({
		workspaceId: "b",
		repoPath: b,
		filePath: ".env.link",
		content: "SYNTHETIC_ONLY=linked edit\n",
		expectedSymlinkTarget: opened.symlinkTarget,
	});
	expect(await readFile(join(a, ".env"), "utf8")).toBe("SYNTHETIC_ONLY=linked edit\n");
	expect((await lstat(join(b, ".env.link"))).isSymbolicLink()).toBe(true);
	expect(await readFile(join(b, ".env"), "utf8")).toBe("SYNTHETIC_ONLY=worktree\n");
});

test("linked saves require the opened target and reject a link retargeted since opening", async () => {
	await symlink(join(a, ".env"), join(b, ".env.link"));
	const opened = await caller.getFileContent({
		workspaceId: "b",
		repoPath: b,
		filePath: ".env.link",
		ref: "",
	});
	await expect(
		caller.saveFileContent({
			workspaceId: "b",
			repoPath: b,
			filePath: ".env.link",
			content: "wrong",
		})
	).rejects.toThrow();
	await rm(join(b, ".env.link"));
	await symlink(join(b, ".env"), join(b, ".env.link"));
	await expect(
		caller.saveFileContent({
			workspaceId: "b",
			repoPath: b,
			filePath: ".env.link",
			content: "wrong",
			expectedSymlinkTarget: opened.symlinkTarget,
		})
	).rejects.toThrow();
	await rm(join(b, ".env.link"));
	await writeFile(join(b, ".env.link"), "replacement");
	await expect(
		caller.saveFileContent({
			workspaceId: "b",
			repoPath: b,
			filePath: ".env.link",
			content: "wrong",
			expectedSymlinkTarget: opened.symlinkTarget,
		})
	).rejects.toThrow();
	expect(await readFile(join(a, ".env"), "utf8")).toBe("SYNTHETIC_ONLY=main\n");
	expect(await readFile(join(b, ".env"), "utf8")).toBe("SYNTHETIC_ONLY=worktree\n");
	expect(await readFile(join(b, ".env.link"), "utf8")).toBe("replacement");
});

test("explicit linked opens support relative targets but reject dangling links, directories and cycles", async () => {
	await symlink(".env", join(b, "relative"));
	expect(
		(await caller.getFileContent({ workspaceId: "b", repoPath: b, filePath: "relative", ref: "" }))
			.content
	).toBe("SYNTHETIC_ONLY=worktree\n");
	await symlink("absent", join(b, "broken"));
	await symlink(a, join(b, "directory"));
	await symlink("cycle", join(b, "cycle"));
	for (const filePath of ["broken", "directory", "cycle"]) {
		await expect(
			caller.getFileContent({ workspaceId: "b", repoPath: b, filePath, ref: "" })
		).rejects.toThrow();
	}
	await expect(
		caller.createFile({ workspaceId: "b", repoPath: b, filePath: "relative" })
	).rejects.toThrow();
});

test("link targets cannot be directories or special files, and deleted targets are not recreated by save", async () => {
	const fifo = Bun.spawnSync(["mkfifo", join(a, "pipe")]);
	expect(fifo.exitCode).toBe(0);
	await symlink(join(a, "pipe"), join(b, "pipe-link"));
	await expect(
		caller.getFileContent({ workspaceId: "b", repoPath: b, filePath: "pipe-link", ref: "" })
	).rejects.toThrow();
	await symlink(join(a, ".env"), join(b, ".env.link"));
	const opened = await caller.getFileContent({
		workspaceId: "b",
		repoPath: b,
		filePath: ".env.link",
		ref: "",
	});
	await rm(join(a, ".env"));
	await expect(
		caller.saveFileContent({
			workspaceId: "b",
			repoPath: b,
			filePath: ".env.link",
			content: "wrong",
			expectedSymlinkTarget: opened.symlinkTarget,
		})
	).rejects.toThrow();
	await expect(readFile(join(a, ".env"), "utf8")).rejects.toThrow();
});
