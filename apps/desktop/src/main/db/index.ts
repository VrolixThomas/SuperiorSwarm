import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { app } from "electron";
import { parseRemoteUrl } from "../git/operations";
import * as schema from "./schema";

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _rawSqlite: Database.Database | null = null;

function getDbPath(): string {
	const userDataPath = app.getPath("userData");
	return join(userDataPath, "superiorswarm.db");
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
	sqlite.pragma("busy_timeout = 5000");
	sqlite.pragma("foreign_keys = ON");

	_rawSqlite = sqlite;
	_db = drizzle(sqlite, { schema });
	return _db;
}

export function initializeDatabase(): void {
	const db = getDb();
	const migrationsFolder = join(__dirname, "db/migrations");
	migrate(db, { migrationsFolder });
}

export async function backfillRemoteHosts(): Promise<void> {
	const db = getDb();
	const needsBackfill = db
		.select({
			id: schema.projects.id,
			repoPath: schema.projects.repoPath,
			kind: schema.projects.kind,
		})
		.from(schema.projects)
		.where(isNull(schema.projects.remoteHost))
		.all();

	for (const project of needsBackfill) {
		if (project.kind !== "repo") continue;
		const remote = await parseRemoteUrl(project.repoPath);
		if (remote?.host) {
			db.update(schema.projects)
				.set({ remoteHost: remote.host })
				.where(eq(schema.projects.id, project.id))
				.run();
		}
	}
}

export { schema };

/** Test-only: replace the cached db handle so unit tests can run against in-memory sqlite. */
export function _setDbForTesting(testDb: ReturnType<typeof drizzle<typeof schema>> | null): void {
	_db = testDb;
}

/** Internal: checkpoint + close a raw handle. Idempotent. Exported for tests. */
export function _closeRawDb(sqlite: Database.Database): void {
	try {
		if (!sqlite.open) return;
		try {
			// PASSIVE: never blocks on the busy_timeout if the daemon still holds WAL
			// locks. A synchronous TRUNCATE could stall the main thread up to 5s at
			// quit, and the in-process watchdog timer cannot fire mid native call. The
			// WAL is durable and gets checkpointed on next open regardless.
			sqlite.pragma("wal_checkpoint(PASSIVE)");
		} catch {
			// checkpoint is best-effort
		}
		sqlite.close();
	} catch {
		// already closed / closing - ignore
	}
}

/** Close the app database at quit. Safe to call when never opened. */
export function closeDb(): void {
	if (_rawSqlite) {
		_closeRawDb(_rawSqlite);
		_rawSqlite = null;
	}
	_db = null;
}
