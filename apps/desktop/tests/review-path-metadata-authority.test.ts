import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import type { getDb } from "../src/main/db";
import * as schema from "../src/main/db/schema";
import { ReviewPathApplication } from "../src/main/review-path/application";
import { ReviewPathStorage } from "../src/main/review-path/storage";
import type { ReviewPathIdentity } from "../src/shared/review-path-runtime";
import { agent, authorityFixture, identity } from "./helpers/review-path-authority-fixture";

const fixtures: ReturnType<typeof authorityFixture>[] = [];
afterEach(() => {
	for (const f of fixtures.splice(0)) f.close();
});
function setup() {
	const f = authorityFixture();
	fixtures.push(f);
	f.storage.get(identity);
	const calls: string[] = [];
	const runtime = {
		startMapping: async () => {
			calls.push("start");
			return {};
		},
		ask: async () => {
			calls.push("ask");
			return {};
		},
		stopMapping: async () => {
			calls.push("stop");
		},
		cancelQuestion: async () => {
			calls.push("cancel");
		},
	};
	const pending: {
		resolve: (v: { identity: ReviewPathIdentity; changedFiles: string[] }) => void;
		reject: (e: Error) => void;
	}[] = [];
	const app = () =>
		new ReviewPathApplication({
			storage: new ReviewPathStorage(f.db),
			validateWorkspace: () => {},
			runtime: () => runtime,
			resolve: () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
		});
	const b = { ...identity, headSha: "b".repeat(40) };
	const c = { ...identity, headSha: "c".repeat(40) };
	return { ...f, calls, app, pending, b, c };
}
for (const method of ["get", "start", "ask"] as const)
	for (const outcome of ["matching", "mismatched", "error"] as const)
		test(`fresh application instances fence late ${method} ${outcome} resolution and preserve current callbacks`, async () => {
			const f = setup();
			const olderApp = f.app();
			const old = (
				method === "get"
					? olderApp.get(f.b)
					: method === "start"
						? olderApp.start({ identity: f.b, agent, alsoReview: false })
						: olderApp.ask(f.b, { id: "old", text: "Old?" })
			).then(
				(value) => ({ value }),
				(error) => ({ error })
			);
			const newer = f.app().start({ identity: f.c, agent, alsoReview: false });
			required(f.pending[1]).resolve({ identity: f.c, changedFiles: ["a.ts"] });
			const { run } = await newer;
			const capability = f.storage.grantCapability(run);
			if (outcome === "error") required(f.pending[0]).reject(Error("Provider unavailable"));
			else
				required(f.pending[0]).resolve({
					identity: outcome === "matching" ? f.b : identity,
					changedFiles: ["a.ts"],
				});
			const result = await old;
			if (method === "get" && outcome !== "error") {
				if (!("value" in result) || !("identity" in result.value))
					throw Error("Expected latest snapshot");
				expect(result.value.identity).toEqual(f.c);
			} else expect("error" in result).toBe(true);
			expect(f.storage.peek(identity).identity).toEqual(f.c);
			expect(f.storage.authenticateCapability(capability).id).toBe(run.id);
			f.storage.addStep(run, "e", "Entry", {
				id: "s",
				kind: "changed",
				path: "a.ts",
				note: "Current callback",
				focus: [],
				tests: [],
			});
			expect(f.storage.peek(f.c).path?.entries[0]?.steps[0]?.note).toBe("Current callback");
			expect(f.calls).toEqual(["start"]);
		});

test("a newer failed observation still fences older metadata; a later force push back is legitimate", async () => {
	const f = setup();
	const old = f.app().get(f.b);
	const newer = f
		.app()
		.start({ identity: f.c, agent, alsoReview: false })
		.catch(() => undefined);
	required(f.pending[1]).reject(Error("Provider unavailable"));
	await newer;
	required(f.pending[0]).resolve({ identity: f.b, changedFiles: [] });
	await old;
	expect(f.storage.peek(identity).identity).toEqual(identity);
	const forward = f.app().get(f.c);
	required(f.pending[2]).resolve({ identity: f.c, changedFiles: [] });
	await forward;
	const back = f.app().get(identity);
	required(f.pending[3]).resolve({ identity, changedFiles: [] });
	await back;
	expect(f.storage.peek(identity).identity).toEqual(identity);
});

test("same-head direct remapping and separate database connections fence old provider metadata", async () => {
	const f = setup();
	const older = f.app().get(f.b);
	const sql = new Database(join(f.root, "test.db"));
	try {
		const store = new ReviewPathStorage(
			drizzle(sql, { schema }) as unknown as ReturnType<typeof getDb>
		);
		const current = store.begin(identity, agent, ["a.ts"]);
		const token = store.grantCapability(current);
		required(f.pending[0]).resolve({ identity: f.b, changedFiles: ["a.ts"] });
		await older;
		expect(store.peek(identity).identity).toEqual(identity);
		expect(store.authenticateCapability(token).id).toBe(current.id);
	} finally {
		sql.close();
	}
});

for (const dimension of ["workspaceId", "provider", "owner", "repo", "prNumber"] as const)
	test(`metadata generations are independent across ${dimension}`, async () => {
		const f = setup();
		const different = {
			workspaceId: "other",
			provider: "bitbucket",
			owner: "different",
			repo: "different",
			prNumber: 2,
		};
		const other = { ...f.c, [dimension]: different[dimension] } as ReviewPathIdentity;
		const first = f.app().get(f.b);
		const second = f.app().start({ identity: other, agent, alsoReview: false });
		required(f.pending[1]).resolve({ identity: other, changedFiles: ["a.ts"] });
		await second;
		required(f.pending[0]).resolve({ identity: f.b, changedFiles: ["a.ts"] });
		await first;
		expect(f.storage.peek(identity).identity).toEqual(f.b);
		expect(f.storage.peek(other).identity).toEqual(other);
	});

test("a resolver cannot apply an identity from another scope", async () => {
	const f = setup();
	const result = f
		.app()
		.get(f.b)
		.catch(() => undefined);
	required(f.pending[0]).resolve({ identity: { ...f.b, repo: "foreign" }, changedFiles: [] });
	await result;
	expect(f.storage.peek(identity).identity).toEqual(identity);
	expect(f.db.select().from(schema.reviewPathDocuments).all()).toHaveLength(1);
});

function required<T>(value: T | undefined): T {
	if (value === undefined) throw Error("Missing pending request");
	return value;
}
