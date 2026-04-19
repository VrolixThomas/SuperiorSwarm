import { beforeEach, describe, expect, test } from "bun:test";
import { createReviewTestDb } from "./helpers/review-test-db";
import { setViewed, getViewed, unsetViewed } from "../src/main/review/viewed-ops";

describe("review viewed-ops", () => {
	let db: ReturnType<typeof createReviewTestDb>;

	beforeEach(() => {
		db = createReviewTestDb();
	});

	test("setViewed inserts a row", () => {
		setViewed(db, { workspaceId: "ws1", filePath: "a.ts", contentHash: "h1" });
		const rows = getViewed(db, "ws1");
		expect(rows.length).toBe(1);
		expect(rows[0].filePath).toBe("a.ts");
		expect(rows[0].contentHash).toBe("h1");
	});

	test("setViewed upserts on conflict (same workspace + path)", () => {
		setViewed(db, { workspaceId: "ws1", filePath: "a.ts", contentHash: "h1" });
		setViewed(db, { workspaceId: "ws1", filePath: "a.ts", contentHash: "h2" });
		const rows = getViewed(db, "ws1");
		expect(rows.length).toBe(1);
		expect(rows[0].contentHash).toBe("h2");
	});

	test("unsetViewed removes a row", () => {
		setViewed(db, { workspaceId: "ws1", filePath: "a.ts", contentHash: "h1" });
		unsetViewed(db, { workspaceId: "ws1", filePath: "a.ts" });
		expect(getViewed(db, "ws1").length).toBe(0);
	});

	test("getViewed is scoped by workspaceId", () => {
		setViewed(db, { workspaceId: "ws1", filePath: "a.ts", contentHash: "h1" });
		setViewed(db, { workspaceId: "ws2", filePath: "a.ts", contentHash: "h2" });
		expect(getViewed(db, "ws1").length).toBe(1);
		expect(getViewed(db, "ws2").length).toBe(1);
	});
});
