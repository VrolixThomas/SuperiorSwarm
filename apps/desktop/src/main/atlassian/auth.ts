import { eq } from "drizzle-orm";
import { safeStorage } from "electron";
import { getDb } from "../db";
import { atlassianAuth } from "../db/schema";
import {
	BITBUCKET_CLIENT_ID,
	BITBUCKET_CLIENT_SECRET,
	BITBUCKET_TOKEN_URL,
	JIRA_CLIENT_ID,
	JIRA_CLIENT_SECRET,
	JIRA_TOKEN_URL,
} from "./constants";

type Service = "jira" | "bitbucket";

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

export function getAuth(service: Service) {
	const db = getDb();
	const row = db.select().from(atlassianAuth).where(eq(atlassianAuth.service, service)).get();
	if (!row) return null;
	return {
		...row,
		accessToken: decrypt(row.accessToken),
		refreshToken: decrypt(row.refreshToken),
	};
}

export function saveAuth(data: {
	service: Service;
	accessToken: string;
	refreshToken: string;
	expiresIn: number;
	cloudId?: string;
	siteUrl?: string;
	accountId: string;
	displayName?: string;
}) {
	const db = getDb();
	const expiresAt = new Date(Date.now() + data.expiresIn * 1000);
	const encAccessToken = encrypt(data.accessToken);
	const encRefreshToken = encrypt(data.refreshToken);

	db.insert(atlassianAuth)
		.values({
			service: data.service,
			accessToken: encAccessToken,
			refreshToken: encRefreshToken,
			expiresAt,
			cloudId: data.cloudId ?? null,
			siteUrl: data.siteUrl ?? null,
			accountId: data.accountId,
			displayName: data.displayName ?? null,
		})
		.onConflictDoUpdate({
			target: atlassianAuth.service,
			set: {
				accessToken: encAccessToken,
				refreshToken: encRefreshToken,
				expiresAt,
				cloudId: data.cloudId ?? null,
				siteUrl: data.siteUrl ?? null,
				accountId: data.accountId,
				displayName: data.displayName ?? null,
			},
		})
		.run();
}

export function deleteAuth(service: Service) {
	const db = getDb();
	db.delete(atlassianAuth).where(eq(atlassianAuth.service, service)).run();
}

async function refreshJiraToken(refreshToken: string): Promise<{
	access_token: string;
	refresh_token: string;
	expires_in: number;
}> {
	const res = await fetch(JIRA_TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			grant_type: "refresh_token",
			client_id: JIRA_CLIENT_ID,
			client_secret: JIRA_CLIENT_SECRET,
			refresh_token: refreshToken,
		}),
	});
	if (!res.ok) {
		throw new Error(`Jira token refresh failed: ${res.status} ${await res.text()}`);
	}
	return res.json();
}

async function refreshBitbucketToken(refreshToken: string): Promise<{
	access_token: string;
	refresh_token: string;
	expires_in: number;
}> {
	const credentials = Buffer.from(`${BITBUCKET_CLIENT_ID}:${BITBUCKET_CLIENT_SECRET}`).toString("base64");
	const res = await fetch(BITBUCKET_TOKEN_URL, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			Authorization: `Basic ${credentials}`,
		},
		body: new URLSearchParams({
			grant_type: "refresh_token",
			refresh_token: refreshToken,
		}),
	});
	if (!res.ok) {
		throw new Error(`Bitbucket token refresh failed: ${res.status} ${await res.text()}`);
	}
	return res.json();
}

// Guard against concurrent refresh requests for the same service
const refreshPromises = new Map<Service, Promise<string | null>>();

async function doRefresh(service: Service): Promise<string | null> {
	const auth = getAuth(service);
	if (!auth) return null;

	try {
		const refreshFn = service === "jira" ? refreshJiraToken : refreshBitbucketToken;
		const result = await refreshFn(auth.refreshToken);

		saveAuth({
			service,
			accessToken: result.access_token,
			refreshToken: result.refresh_token,
			expiresIn: result.expires_in,
			cloudId: auth.cloudId ?? undefined,
			siteUrl: auth.siteUrl ?? undefined,
			accountId: auth.accountId,
			displayName: auth.displayName ?? undefined,
		});

		return result.access_token;
	} catch (err) {
		console.error(`Token refresh failed for ${service}:`, err);
		deleteAuth(service);
		return null;
	}
}

/**
 * Returns a valid access token for the given service.
 * Refreshes automatically if expired. Returns null if not connected.
 * Deduplicates concurrent refresh calls per service.
 */
export async function getValidToken(service: Service): Promise<string | null> {
	const auth = getAuth(service);
	if (!auth) return null;

	// Token still valid — return it
	const now = new Date();
	const bufferMs = 60_000;
	if (auth.expiresAt.getTime() - now.getTime() > bufferMs) {
		return auth.accessToken;
	}

	// Deduplicate concurrent refreshes
	const existing = refreshPromises.get(service);
	if (existing) return existing;

	const promise = doRefresh(service).finally(() => {
		refreshPromises.delete(service);
	});
	refreshPromises.set(service, promise);
	return promise;
}

/**
 * Authenticated fetch — adds Bearer token, refreshes if needed.
 * Throws if not connected or refresh fails.
 * Automatically cleans up auth on 401 responses.
 */
export async function atlassianFetch(service: Service, url: string, init?: RequestInit): Promise<Response> {
	const token = await getValidToken(service);
	if (!token) {
		throw new Error(`Not connected to ${service}`);
	}

	const res = await fetch(url, {
		...init,
		headers: {
			...init?.headers,
			Authorization: `Bearer ${token}`,
			Accept: "application/json",
		},
	});

	if (res.status === 401) {
		deleteAuth(service);
		throw new Error(`${service} session expired. Please reconnect.`);
	}

	return res;
}
