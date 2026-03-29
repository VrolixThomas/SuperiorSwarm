import { createClient } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { safeStorage } from "electron";
import { getDb } from "../db";
import { sessionState } from "../db/schema";

const STORAGE_KEY = "supabase_session";

function encrypt(value: string): string {
	if (safeStorage.isEncryptionAvailable()) {
		return safeStorage.encryptString(value).toString("base64");
	}
	return value;
}

function decrypt(value: string): string {
	if (safeStorage.isEncryptionAvailable()) {
		return safeStorage.decryptString(Buffer.from(value, "base64"));
	}
	return value;
}

/**
 * Custom storage adapter that persists Supabase session data
 * to the SQLite sessionState KV table, encrypted via safeStorage.
 */
const sqliteStorage = {
	getItem(key: string): string | null {
		const db = getDb();
		const storageKey = `${STORAGE_KEY}:${key}`;
		const row = db.select().from(sessionState).where(eq(sessionState.key, storageKey)).get();
		if (!row) return null;
		return decrypt(row.value);
	},
	setItem(key: string, value: string): void {
		const db = getDb();
		const storageKey = `${STORAGE_KEY}:${key}`;
		db.insert(sessionState)
			.values({ key: storageKey, value: encrypt(value) })
			.onConflictDoUpdate({
				target: sessionState.key,
				set: { value: encrypt(value) },
			})
			.run();
	},
	removeItem(key: string): void {
		const db = getDb();
		const storageKey = `${STORAGE_KEY}:${key}`;
		db.delete(sessionState).where(eq(sessionState.key, storageKey)).run();
	},
};

const supabaseUrl = process.env["SUPABASE_URL"];
const supabaseAnonKey = process.env["SUPABASE_ANON_KEY"];

if (!supabaseUrl || !supabaseAnonKey) {
	throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY must be set in .env");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
	auth: {
		storage: sqliteStorage,
		autoRefreshToken: true,
		persistSession: true,
		detectSessionInUrl: false,
		flowType: "pkce",
	},
});
