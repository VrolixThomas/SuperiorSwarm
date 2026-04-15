import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "../src/main/db/schema";

let templateBuffer: Buffer | null = null;

function getTemplate(): Buffer {
	if (templateBuffer) return templateBuffer;
	const sqlite = new Database(":memory:");
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: join(__dirname, "../src/main/db/migrations") });
	templateBuffer = sqlite.serialize();
	sqlite.close();
	return templateBuffer;
}

export function makeRawTestDb(): Database.Database {
	const sqlite = new Database(getTemplate());
	sqlite.pragma("foreign_keys = ON");
	return sqlite;
}

export function makeTestDb() {
	return drizzle(makeRawTestDb(), { schema });
}
