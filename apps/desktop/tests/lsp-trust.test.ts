import "./preload-electron-mock";
import { beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { getDb } from "../src/main/db";
import { getRepoTrust, setRepoTrust } from "../src/main/lsp/trust";

describe("lsp trust store", () => {
	beforeAll(() => {
		const db = getDb();
		migrate(db, { migrationsFolder: join(import.meta.dir, "../src/main/db/migrations") });
	});

	test("default decision is untrusted (undecided)", () => {
		expect(getRepoTrust("/repo/trust-test-a")).toEqual({ trusted: false, decided: false });
	});

	test("setRepoTrust(true) persists trusted decision", () => {
		setRepoTrust("/repo/trust-test-b", true);
		expect(getRepoTrust("/repo/trust-test-b")).toEqual({ trusted: true, decided: true });
	});

	test("setRepoTrust(false) persists explicit deny", () => {
		setRepoTrust("/repo/trust-test-c", false);
		expect(getRepoTrust("/repo/trust-test-c")).toEqual({ trusted: false, decided: true });
	});

	test("setRepoTrust overwrites a prior decision", () => {
		setRepoTrust("/repo/trust-test-d", true);
		setRepoTrust("/repo/trust-test-d", false);
		expect(getRepoTrust("/repo/trust-test-d")).toEqual({ trusted: false, decided: true });
	});
});
