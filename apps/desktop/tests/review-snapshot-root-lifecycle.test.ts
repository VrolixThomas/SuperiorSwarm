import { expect, test } from "bun:test";
import { inIsolatedFileBrowserTest } from "./helpers/isolated-file-browser-test";

if (
	inIsolatedFileBrowserTest(
		import.meta.path,
		"review snapshots survive agent workspace preparation"
	)
) {
	const { execFileSync } = await import("node:child_process");
	const { mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const { eq } = await import("drizzle-orm");
	const { makeTestDb } = await import("./test-db");
	const { _setDbForTesting } = await import("../src/main/db");
	const schema = await import("../src/main/db/schema");
	const { getReviewSnapshotRoot } = await import("../src/main/review-explanation/workspace-root");
	const { ReviewSnapshotService } = await import("../src/main/review-explanation/snapshot");
	test("a logical PR snapshot remains readable after the agent worktree is linked or removed", async () => {
		const directory = mkdtempSync(join(tmpdir(), "review-root-lifecycle-"));
		const root = join(directory, "repo");
		const tree = join(directory, "agent");
		execFileSync("git", ["init", root], { stdio: "pipe" });
		const git = (...args: string[]) =>
			execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" }).trim();
		const commit = () => {
			git("add", ".");
			git(
				"-c",
				"user.name=Test",
				"-c",
				"user.email=test@example.invalid",
				"commit",
				"-m",
				"fixture"
			);
			return git("rev-parse", "HEAD");
		};
		writeFileSync(join(root, "file.ts"), "base\n");
		const base = commit();
		writeFileSync(join(root, "file.ts"), "head\n");
		const head = commit();
		const db = makeTestDb();
		const now = new Date();
		db.insert(schema.projects)
			.values({ id: "p", name: "P", repoPath: root, createdAt: now, updatedAt: now })
			.run();
		db.insert(schema.workspaces)
			.values({
				id: "w",
				projectId: "p",
				name: "PR",
				type: "review",
				prProvider: "github",
				prIdentifier: "o/r#1",
				createdAt: now,
				updatedAt: now,
			})
			.run();
		_setDbForTesting(db);
		try {
			const service = new ReviewSnapshotService({
				resolveRoot: async (id) => getReviewSnapshotRoot(id),
			});
			const snapshot = await service.create({
				workspaceId: "w",
				headOid: head,
				targetTipOid: base,
			});
			const fileId = snapshot.files[0]?.id;
			if (!fileId) throw new Error("Fixture file missing");
			const input = { workspaceId: "w", snapshotId: snapshot.id, fileId, side: "head" as const };
			git("worktree", "add", "--detach", tree, head);
			db.insert(schema.worktrees)
				.values({
					id: "wt",
					projectId: "p",
					path: tree,
					branch: "feature",
					baseBranch: "main",
					createdAt: now,
					updatedAt: now,
				})
				.run();
			db.update(schema.workspaces)
				.set({ worktreeId: "wt" })
				.where(eq(schema.workspaces.id, "w"))
				.run();
			expect(await service.read(input)).toMatchObject({ kind: "text", content: "head\n" });
			git("worktree", "remove", tree);
			expect(await service.read(input)).toMatchObject({ kind: "text", content: "head\n" });
			db.update(schema.projects)
				.set({ repoPath: directory })
				.where(eq(schema.projects.id, "p"))
				.run();
			await expect(service.read(input)).rejects.toThrow("workspace changed");
		} finally {
			_setDbForTesting(null);
			rmSync(directory, { recursive: true, force: true });
		}
	});
}
