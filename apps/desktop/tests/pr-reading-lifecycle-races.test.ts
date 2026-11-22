import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { getDb } from "../src/main/db";
import * as schema from "../src/main/db/schema";
import { ReviewPathApplication } from "../src/main/review-path/application";
import { ReviewPathStorage } from "../src/main/review-path/storage";
import { createReviewPathRouter } from "../src/main/trpc/routers/review-path";
import type { ReviewPathIdentity } from "../src/shared/review-path-runtime";
const agent = { id: "codex", label: "Codex" };
const identity: ReviewPathIdentity = {
	workspaceId: "w",
	provider: "github",
	owner: "o",
	repo: "r",
	prNumber: 1,
	headSha: "c".repeat(40),
};
const dbs: Database[] = [];
afterEach(() => {
	for (const db of dbs.splice(0)) db.close();
});
function fixture() {
	const sql = new Database(":memory:");
	dbs.push(sql);
	sql.exec("PRAGMA foreign_keys=ON");
	const raw = drizzle(sql, { schema });
	migrate(raw, { migrationsFolder: join(import.meta.dir, "../src/main/db/migrations") });
	const db = raw as unknown as ReturnType<typeof getDb>;
	const now = new Date();
	db.insert(schema.projects)
		.values({ id: "p", name: "fixture", repoPath: "/disposable", createdAt: now, updatedAt: now })
		.run();
	db.insert(schema.workspaces)
		.values({
			id: "w",
			projectId: "p",
			name: "review",
			type: "review",
			prProvider: "github",
			prIdentifier: "o/r#1",
			createdAt: now,
			updatedAt: now,
		})
		.run();
	const storage = new ReviewPathStorage(db);
	storage.get(identity);
	const pending: ((value: { identity: ReviewPathIdentity; changedFiles: string[] }) => void)[] = [];
	const app = new ReviewPathApplication({
		storage,
		validateWorkspace: (i) => {
			if (i.workspaceId !== "w") throw Error("Wrong workspace");
		},
		resolve: () => new Promise((resolve) => pending.push(resolve)),
		runtime: () => ({
			startMapping: async () => ({}),
			stopMapping: async () => {},
			ask: async () => ({}),
			cancelQuestion: async () => {},
		}),
	});
	const caller = createReviewPathRouter(() => app).createCaller({});
	return { storage, caller, pending };
}
async function waitFor(check: () => boolean) {
	for (let i = 0; i < 50; i++) {
		if (check()) return;
		await new Promise((r) => setTimeout(r, 1));
	}
	throw Error("Expected provider request");
}
test("late provider read cannot rewind observed head or revoke the newer active capability", async () => {
	const { storage, caller, pending } = fixture();
	const oldIdentity = { ...identity, headSha: "a".repeat(40) };
	const newIdentity = { ...identity, headSha: "b".repeat(40) };
	const oldRead = caller.get({ identity: oldIdentity });
	await waitFor(() => pending.length === 1);
	const newRead = caller.get({ identity: newIdentity });
	await waitFor(() => pending.length === 2);
	pending[1]!({ identity: newIdentity, changedFiles: ["a.ts"] });
	await newRead;
	const current = storage.begin(newIdentity, agent, ["a.ts"]);
	const capability = storage.grantCapability(current);
	pending[0]!({ identity: oldIdentity, changedFiles: ["a.ts"] });
	await oldRead;
	expect(storage.peek(newIdentity).identity.headSha).toBe(newIdentity.headSha);
	expect(storage.getRun(current.id)?.state).toBe("running");
	expect(storage.authenticateCapability(capability).id).toBe(current.id);
});
test("late old-head start resolution cannot supersede a newer mapping", async () => {
	const { storage, caller, pending } = fixture();
	const oldIdentity = { ...identity, headSha: "a".repeat(40) };
	const newIdentity = { ...identity, headSha: "b".repeat(40) };
	const older = caller.start({ identity: oldIdentity, agent, alsoReview: false });
	await waitFor(() => pending.length === 1);
	const newer = caller.start({ identity: newIdentity, agent, alsoReview: false });
	await waitFor(() => pending.length === 2);
	pending[1]!({ identity: newIdentity, changedFiles: ["a.ts"] });
	const newRun = await newer;
	pending[0]!({ identity: oldIdentity, changedFiles: ["a.ts"] });
	await older.catch(() => undefined);
	expect(storage.getRun(newRun.run.id)?.state).toBe("running");
	expect(storage.peek(newIdentity).identity.headSha).toBe(newIdentity.headSha);
});
