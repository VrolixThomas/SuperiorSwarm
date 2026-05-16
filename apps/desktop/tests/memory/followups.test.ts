import "../preload-electron-mock";
import { beforeAll, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { nanoid } from "nanoid";
import { getDb, schema } from "../../src/main/db";
import { addFollowup, listFollowups, updateFollowup } from "../../src/main/memory/followups";

let PROJECT_ID: string;

beforeAll(() => {
	const db = getDb();
	migrate(db, {
		migrationsFolder: join(import.meta.dir, "../../src/main/db/migrations"),
	});
});

beforeEach(() => {
	const db = getDb();
	db.delete(schema.memoryFollowups).run();
	db.delete(schema.projects).run();

	PROJECT_ID = `proj-${nanoid(8)}`;
	const now = new Date();
	db.insert(schema.projects)
		.values({
			id: PROJECT_ID,
			name: "p",
			repoPath: `/tmp/${PROJECT_ID}`,
			defaultBranch: "main",
			createdAt: now,
			updatedAt: now,
		})
		.run();
});

test("addFollowup defaults to open", () => {
	const { id } = addFollowup({ projectId: PROJECT_ID, title: "Ping user" });
	const all = listFollowups({ projectId: PROJECT_ID });
	expect(all.length).toBe(1);
	expect(all[0]?.id).toBe(id);
	expect(all[0]?.status).toBe("open");
});

test("listFollowups filters by status and owner", () => {
	addFollowup({ projectId: PROJECT_ID, title: "A", owner: "user" });
	const b = addFollowup({ projectId: PROJECT_ID, title: "B", owner: "agent" });
	updateFollowup({ id: b.id, status: "done" });

	const open = listFollowups({ projectId: PROJECT_ID, status: "open" });
	expect(open.length).toBe(1);
	expect(open[0]?.title).toBe("A");

	const agent = listFollowups({ projectId: PROJECT_ID, owner: "agent" });
	expect(agent.length).toBe(1);
	expect(agent[0]?.id).toBe(b.id);
});

test("listFollowups filters by due_before and due_after", () => {
	const past = new Date("2026-01-01");
	const future = new Date("2027-01-01");
	addFollowup({ projectId: PROJECT_ID, title: "past", dueAt: past });
	addFollowup({ projectId: PROJECT_ID, title: "future", dueAt: future });

	const overdue = listFollowups({
		projectId: PROJECT_ID,
		dueBefore: new Date("2026-06-01"),
	});
	expect(overdue.map((f) => f.title)).toEqual(["past"]);

	const upcoming = listFollowups({
		projectId: PROJECT_ID,
		dueAfter: new Date("2026-06-01"),
	});
	expect(upcoming.map((f) => f.title)).toEqual(["future"]);
});
