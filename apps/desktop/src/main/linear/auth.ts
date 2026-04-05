import { eq } from "drizzle-orm";
import { safeStorage } from "electron";
import { getDb } from "../db";
import { linearAuth } from "../db/schema";
import {
	LINEAR_API_URL,
	LINEAR_CLIENT_ID,
	LINEAR_CLIENT_SECRET,
	LINEAR_TOKEN_URL,
} from "./constants";

const LINEAR_AUTH_ID = "linear";

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
	const row = db.select().from(linearAuth).where(eq(linearAuth.id, LINEAR_AUTH_ID)).get();
	if (!row) return null;
	return {
		...row,
		accessToken: decrypt(row.accessToken),
		refreshToken: decrypt(row.refreshToken),
	};
}

export function saveAuth(data: {
	accessToken: string;
	refreshToken: string;
	expiresIn: number;
	accountId: string;
	displayName?: string;
	email?: string | null;
}) {
	const db = getDb();
	const expiresAt = new Date(Date.now() + data.expiresIn * 1000);
	const encAccessToken = encrypt(data.accessToken);
	const encRefreshToken = encrypt(data.refreshToken);

	db.insert(linearAuth)
		.values({
			id: LINEAR_AUTH_ID,
			accessToken: encAccessToken,
			refreshToken: encRefreshToken,
			expiresAt,
			accountId: data.accountId,
			displayName: data.displayName ?? null,
			email: data.email ?? null,
		})
		.onConflictDoUpdate({
			target: linearAuth.id,
			set: {
				accessToken: encAccessToken,
				refreshToken: encRefreshToken,
				expiresAt,
				accountId: data.accountId,
				displayName: data.displayName ?? null,
				email: data.email ?? null,
			},
		})
		.run();
}

export function deleteAuth() {
	const db = getDb();
	db.delete(linearAuth).where(eq(linearAuth.id, LINEAR_AUTH_ID)).run();
}

async function doRefresh(refreshToken: string): Promise<{
	access_token: string;
	refresh_token: string;
	expires_in: number;
}> {
	const res = await fetch(LINEAR_TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "refresh_token",
			client_id: LINEAR_CLIENT_ID,
			client_secret: LINEAR_CLIENT_SECRET,
			refresh_token: refreshToken,
		}),
	});
	if (!res.ok) {
		throw new Error(`Linear token refresh failed: ${res.status} ${await res.text()}`);
	}
	return res.json();
}

let refreshPromise: Promise<string | null> | null = null;

/**
 * Returns a valid access token, refreshing automatically if expired.
 * Returns null if not connected. Deduplicates concurrent refresh calls.
 */
export async function getValidToken(): Promise<string | null> {
	const auth = getAuth();
	if (!auth) return null;

	const now = new Date();
	const bufferMs = 60_000;
	if (auth.expiresAt.getTime() - now.getTime() > bufferMs) {
		return auth.accessToken;
	}

	if (refreshPromise) return refreshPromise;

	const promise = doRefresh(auth.refreshToken)
		.then((result) => {
			saveAuth({
				accessToken: result.access_token,
				refreshToken: result.refresh_token,
				expiresIn: result.expires_in,
				accountId: auth.accountId,
				displayName: auth.displayName ?? undefined,
				email: auth.email ?? undefined,
			});
			return result.access_token;
		})
		.catch((err) => {
			console.error("Linear token refresh failed:", err);
			deleteAuth();
			return null;
		})
		.finally(() => {
			refreshPromise = null;
		});

	refreshPromise = promise;
	return promise;
}

/**
 * Authenticated fetch to the Linear GraphQL API.
 * Throws if not connected. Clears auth on 401.
 */
export async function linearFetch(body: {
	query: string;
	variables?: Record<string, unknown>;
}): Promise<Response> {
	const token = await getValidToken();
	if (!token) throw new Error("Not connected to Linear");

	const res = await fetch(LINEAR_API_URL, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
	});

	if (res.status === 401) {
		deleteAuth();
		throw new Error("Linear session expired. Please reconnect.");
	}

	return res;
}
