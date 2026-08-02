import { eq } from "drizzle-orm";
import { safeStorage } from "electron";
import { getDb } from "../db";
import { atlassianAuth } from "../db/schema";
import { markProviderConnected } from "../telemetry/state";
import { TokenEndpointError, createAuthCore } from "./auth-core";
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
	email?: string | null;
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
			email: data.email ?? null,
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
				email: data.email ?? null,
			},
		})
		.run();
	markProviderConnected(db, data.service);
}

export function deleteAuth(service: Service) {
	const db = getDb();
	db.delete(atlassianAuth).where(eq(atlassianAuth.service, service)).run();
}

function createTokenEndpointError(service: Service, status: number, body: string) {
	let oauthError: string | undefined;
	try {
		const parsed = JSON.parse(body) as { error?: unknown };
		if (typeof parsed.error === "string") oauthError = parsed.error;
	} catch {
		// Preserve the response text for diagnostics when the endpoint did not return JSON.
	}
	return new TokenEndpointError(status, `${service} token refresh failed: ${body}`, oauthError);
}

/**
 * A second app process can rotate an Atlassian refresh token while this process
 * still has the previous token in flight. Never let a late invalid_grant erase
 * credentials that another process has already replaced.
 */
function deleteAuthIfRefreshTokenMatches(service: Service, refreshToken: string) {
	const db = getDb();
	db.transaction((tx) => {
		const row = tx.select().from(atlassianAuth).where(eq(atlassianAuth.service, service)).get();
		if (row && decrypt(row.refreshToken) === refreshToken) {
			tx.delete(atlassianAuth).where(eq(atlassianAuth.service, service)).run();
		}
	});
}

async function refreshJiraToken(refreshToken: string): Promise<{
	access_token: string;
	refresh_token?: string;
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
		throw createTokenEndpointError("jira", res.status, await res.text());
	}
	return (await res.json()) as {
		access_token: string;
		refresh_token?: string;
		expires_in: number;
	};
}

async function refreshBitbucketToken(refreshToken: string): Promise<{
	access_token: string;
	refresh_token?: string;
	expires_in: number;
}> {
	const credentials = Buffer.from(`${BITBUCKET_CLIENT_ID}:${BITBUCKET_CLIENT_SECRET}`).toString(
		"base64"
	);
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
		throw createTokenEndpointError("bitbucket", res.status, await res.text());
	}
	return (await res.json()) as {
		access_token: string;
		refresh_token?: string;
		expires_in: number;
	};
}

// Token lifecycle (expiry check, refresh dedup, transient-vs-permanent failure
// handling, 401 retry) lives in auth-core.ts so it can be unit-tested without
// Electron or the database.
const core = createAuthCore<Service>({
	getAuth,
	saveTokens(service, tokens) {
		const auth = getAuth(service);
		if (!auth) return;
		saveAuth({
			service,
			accessToken: tokens.accessToken,
			refreshToken: tokens.refreshToken,
			expiresIn: tokens.expiresIn,
			cloudId: auth.cloudId ?? undefined,
			siteUrl: auth.siteUrl ?? undefined,
			accountId: auth.accountId,
			displayName: auth.displayName ?? undefined,
			email: auth.email ?? undefined,
		});
	},
	deleteAuthIfRefreshTokenMatches,
	refreshToken(service, refreshToken) {
		return service === "jira"
			? refreshJiraToken(refreshToken)
			: refreshBitbucketToken(refreshToken);
	},
});

/**
 * Returns a valid access token for the given service.
 * Refreshes automatically if expired. Returns null if not connected.
 * Deduplicates concurrent refresh calls per service.
 */
export const getValidToken = core.getValidToken;

/**
 * Authenticated fetch — adds Bearer token, refreshes if needed.
 * Throws if not connected or refresh fails.
 * On a 401 API response, force-refreshes the token and retries once. A repeated
 * endpoint-level 401 is surfaced without deleting the saved connection.
 */
export const atlassianFetch = core.authFetch;
