import { describe, expect, mock, test } from "bun:test";

mock.module("electron", () => ({
	app: { getPath: () => "/tmp/superiorswarm-test" },
}));

const { _closeRawDb } = await import("../src/main/db");

function makeFakeDb() {
	let open = true;
	let checkpointed = false;
	return {
		get open() {
			return open;
		},
		pragma(sql: string) {
			if (!open) throw new Error("database is not open");
			if (sql.includes("wal_checkpoint")) checkpointed = true;
		},
		close() {
			open = false;
		},
		wasCheckpointed: () => checkpointed,
	};
}

describe("_closeRawDb", () => {
	test("checkpoints and closes an open handle, and is idempotent", () => {
		const db = makeFakeDb();
		expect(db.open).toBe(true);
		_closeRawDb(db as never);
		expect(db.open).toBe(false);
		expect(db.wasCheckpointed()).toBe(true);
		// second call must not throw
		_closeRawDb(db as never);
		expect(db.open).toBe(false);
	});
});
