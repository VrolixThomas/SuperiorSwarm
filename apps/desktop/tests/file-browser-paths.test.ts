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

test("scoped editor routes reject symlink files/parents, special files and escaping/root paths", async () => {
	await symlink(a, join(b, "link"));
	await symlink(join(a, ".env"), join(b, ".env.link"));
	for (const filePath of ["link/.env", ".env.link", "../main/.env", join(b, ".env"), "", "."]) {
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
