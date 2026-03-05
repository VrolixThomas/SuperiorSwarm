import { eq } from "drizzle-orm";
import { safeStorage } from "electron";
import { getDb } from "../db";
import { githubAuth } from "../db/schema";
import { GITHUB_API_BASE } from "./constants";

const GITHUB_AUTH_ID = "github";

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

export function getAuth() {
	const db = getDb();
	const row = db.select().from(githubAuth).where(eq(githubAuth.id, GITHUB_AUTH_ID)).get();
	if (!row) return null;
	return { ...row, accessToken: decrypt(row.accessToken) };
}

export function saveAuth(data: { accessToken: string; accountId: string; displayName?: string }) {
	const db = getDb();
	const encAccessToken = encrypt(data.accessToken);
	db.insert(githubAuth)
		.values({
			id: GITHUB_AUTH_ID,
			accessToken: encAccessToken,
			accountId: data.accountId,
			displayName: data.displayName ?? null,
		})
		.onConflictDoUpdate({
			target: githubAuth.id,
			set: {
				accessToken: encAccessToken,
				accountId: data.accountId,
				displayName: data.displayName ?? null,
			},
		})
		.run();
}

export function deleteAuth() {
	const db = getDb();
	db.delete(githubAuth).where(eq(githubAuth.id, GITHUB_AUTH_ID)).run();
}

/**
 * Returns the stored access token, or null if not connected.
 */
export function getValidToken(): string | null {
	const auth = getAuth();
	return auth?.accessToken ?? null;
}

/**
 * Authenticated fetch to the GitHub REST API.
 * Throws if not connected. Clears auth on 401.
 */
export async function githubFetch(path: string, options: RequestInit = {}): Promise<Response> {
	const token = getValidToken();
	if (!token) throw new Error("Not connected to GitHub");

	const res = await fetch(`${GITHUB_API_BASE}${path}`, {
		...options,
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: "application/vnd.github+json",
			"X-GitHub-Api-Version": "2022-11-28",
			...options.headers,
		},
	});

	if (res.status === 401) {
		deleteAuth();
		throw new Error("GitHub session expired. Please reconnect.");
	}

	return res;
}
