import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { app } from "electron";
import * as schema from "./schema";

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

function getDbPath(): string {
	const userDataPath = app.getPath("userData");
	return join(userDataPath, "branchflux.db");
}

export function getDb() {
	if (_db) return _db;

	const dbPath = getDbPath();
	const dir = dirname(dbPath);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}

	const sqlite = new Database(dbPath);
	sqlite.pragma("journal_mode = WAL");
	sqlite.pragma("foreign_keys = ON");

	_db = drizzle(sqlite, { schema });
	return _db;
}

export function initializeDatabase(): void {
	const db = getDb();
	const migrationsFolder = join(__dirname, "db/migrations");
	migrate(db, { migrationsFolder });
}

export { schema };
