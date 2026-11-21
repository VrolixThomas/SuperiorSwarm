import { expect, test } from "bun:test";
import { inIsolatedFileBrowserTest } from "./helpers/isolated-file-browser-test";

if (
	inIsolatedFileBrowserTest(import.meta.path, "runtime cancellation during local Git validation")
) {
	const { mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const { makeTestDb } = await import("./test-db");
	const schema = await import("../src/main/db/schema");
	const { _setDbForTesting } = await import("../src/main/db");
	const { ReviewPathStorage } = await import("../src/main/review-path/storage");
	const { getReviewPathRuntime } = await import("../src/main/review-path/runtime");
	const { setDaemonClient } = await import("../src/main/terminal/daemon-instance");
	const { registerGitProvider } = await import("../src/main/providers/git-provider");
	test("cancel and supersession abort an in-flight object read before metadata/draft/prompt side effects", async () => {
		const root = mkdtempSync(join(tmpdir(), "runtime-cancel-"));
		const path = process.env["PATH"];
		const db = makeTestDb();
		const now = new Date();
		db.insert(schema.projects)
			.values({ id: "p", name: "P", repoPath: root, createdAt: now, updatedAt: now })
			.run();
		db.insert(schema.workspaces)
			.values({
				id: "w",
				projectId: "p",
				name: "W",
				type: "review",
				prProvider: "github",
				prIdentifier: "o/r#1",
				createdAt: now,
				updatedAt: now,
			})
			.run();
		_setDbForTesting(db);
		const store = new ReviewPathStorage(db);
		const runtime = getReviewPathRuntime(store);
		let metadataReads = 0;
		registerGitProvider({
			name: "github",
			getPRDetails: async () => {
				metadataReads++;
				throw Error("unexpected metadata read");
			},
		} as unknown as import("../src/main/providers/types").GitProvider);
		setDaemonClient({ isConnected: true, dispose: () => {} } as unknown as import(
			"../src/main/terminal/daemon-client"
		).DaemonClient);
		writeFileSync(join(root, "git"), "#!/bin/sh\ntrap '' TERM\nexec /bin/sleep 60\n", {
			mode: 0o700,
		});
		process.env["PATH"] = root;
		try {
			const identity = {
				workspaceId: "w",
				provider: "github" as const,
				owner: "o",
				repo: "r",
				prNumber: 1,
				headSha: "a".repeat(40),
			};
			const agent = { id: "codex", label: "Codex" };
			for (const mode of ["cancel", "supersede"]) {
				const run = store.begin(identity, agent, ["a.ts"]);
				const pending = runtime.startMapping({ run, agent, alsoReview: true }).then(
					() => false,
					() => true
				);
				await new Promise((resolve) => setTimeout(resolve, 40));
				if (mode === "cancel") await runtime.stopMapping({ run });
				else store.begin({ ...identity, headSha: "b".repeat(40) }, agent, ["a.ts"]);
				expect(await pending).toBe(true);
			}
			expect(metadataReads).toBe(0);
			expect(db.select().from(schema.reviewDrafts).all()).toEqual([]);
			expect(db.select().from(schema.terminalSessions).all()).toEqual([]);
		} finally {
			process.env["PATH"] = path;
			setDaemonClient({ isConnected: false } as import(
				"../src/main/terminal/daemon-client"
			).DaemonClient);
			_setDbForTesting(null);
			rmSync(root, { recursive: true, force: true });
		}
	});
}
