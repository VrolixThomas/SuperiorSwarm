import { eq } from "drizzle-orm";
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

export function getAuth(service: Service) {
	const db = getDb();
	return db.select().from(atlassianAuth).where(eq(atlassianAuth.service, service)).get() ?? null;
}

export function saveAuth(data: {
	service: Service;
	accessToken: string;
	refreshToken: string;
	expiresIn: number;
	cloudId?: string;
	accountId: string;
	displayName?: string;
}) {
	const db = getDb();
	const expiresAt = new Date(Date.now() + data.expiresIn * 1000);

	db.insert(atlassianAuth)
		.values({
			service: data.service,
			accessToken: data.accessToken,
			refreshToken: data.refreshToken,
			expiresAt,
			cloudId: data.cloudId ?? null,
			accountId: data.accountId,
			displayName: data.displayName ?? null,
		})
		.onConflictDoUpdate({
			target: atlassianAuth.service,
			set: {
				accessToken: data.accessToken,
				refreshToken: data.refreshToken,
				expiresAt,
				cloudId: data.cloudId ?? null,
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

/**
 * Returns a valid access token for the given service.
 * Refreshes automatically if expired. Returns null if not connected.
 */
export async function getValidToken(service: Service): Promise<string | null> {
	const auth = getAuth(service);
	if (!auth) return null;

	// Refresh if expiring within 60 seconds
	const now = new Date();
	const bufferMs = 60_000;
	if (auth.expiresAt.getTime() - now.getTime() > bufferMs) {
		return auth.accessToken;
	}

	try {
		const refreshFn = service === "jira" ? refreshJiraToken : refreshBitbucketToken;
		const result = await refreshFn(auth.refreshToken);

		saveAuth({
			service,
			accessToken: result.access_token,
			refreshToken: result.refresh_token,
			expiresIn: result.expires_in,
			cloudId: auth.cloudId ?? undefined,
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
 * Authenticated fetch — adds Bearer token, refreshes if needed.
 * Throws if not connected or refresh fails.
 */
export async function atlassianFetch(service: Service, url: string, init?: RequestInit): Promise<Response> {
	const token = await getValidToken(service);
	if (!token) {
		throw new Error(`Not connected to ${service}`);
	}

	return fetch(url, {
		...init,
		headers: {
			...init?.headers,
			Authorization: `Bearer ${token}`,
			Accept: "application/json",
		},
	});
}
