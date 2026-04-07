import { Database as BunDatabase } from "bun:sqlite";
import { mock } from "bun:test";

mock.module("electron", () => ({
	safeStorage: {
		isEncryptionAvailable: () => false,
		encryptString: (s: string) => Buffer.from(s),
		decryptString: (b: Buffer) => b.toString(),
	},
	app: {
		getPath: (_name: string) => `/tmp/superiorswarm-test-${process.pid}`,
		isPackaged: false,
	},
	ipcMain: {
		handle: () => {},
		on: () => {},
	},
	shell: {
		openExternal: async () => {},
	},
	BrowserWindow: class {},
	dialog: {
		showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
	},
}));

// Shim better-sqlite3 with bun:sqlite so tests can run without the native addon.
mock.module("better-sqlite3", () => {
	class Database {
		private _db: BunDatabase;

		constructor(path: string, _opts?: unknown) {
			this._db = new BunDatabase(path);
		}

		get open(): boolean {
			return !this._db.closed;
		}

		pragma(str: string): unknown {
			return this._db.exec(`PRAGMA ${str}`);
		}

		exec(sql: string): this {
			this._db.exec(sql);
			return this;
		}

		prepare(sql: string) {
			const stmt = this._db.query(sql);
			const wrapper = {
				run: (...params: unknown[]) => stmt.run(...params),
				get: (...params: unknown[]) => stmt.get(...params),
				all: (...params: unknown[]) => stmt.all(...params),
				raw: () => ({
					get: (...params: unknown[]) => stmt.values(...params)[0] ?? null,
					all: (...params: unknown[]) => stmt.values(...params),
				}),
			};
			return wrapper;
		}

		transaction<T>(fn: () => T): () => T {
			return () => {
				const tx = this._db.transaction(fn);
				return tx();
			};
		}

		close(): void {
			this._db.close();
		}
	}

	// Default export compatible with `new Database(path)` usage.
	return { default: Database };
});

mock.module("electron-log/main.js", () => ({
	default: {
		initialize: () => {},
		transports: {
			file: { level: "info", maxSize: 0, format: "" },
			console: { level: false },
		},
		errorHandler: { startCatching: () => {} },
		info: () => {},
		warn: () => {},
		error: () => {},
		debug: () => {},
	},
}));
