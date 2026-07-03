/**
 * Pure token-lifecycle logic for Atlassian OAuth services, decoupled from
 * Electron, the database, and global fetch so it can be unit-tested directly.
 * `auth.ts` wires it to the real store and token endpoints.
 */

/**
 * Error from the OAuth token endpoint itself. Carries the HTTP status so the
 * refresh flow can distinguish a dead refresh token (4xx → re-auth required)
 * from a transient outage (5xx/429/network → keep credentials, retry later).
 */
export class TokenEndpointError extends Error {
	constructor(
		readonly status: number,
		message: string
	) {
		super(message);
	}
}

export interface TokenRefreshResult {
	access_token: string;
	refresh_token?: string;
	expires_in: number;
}

export interface AuthCoreDeps<S extends string> {
	getAuth(service: S): { accessToken: string; refreshToken: string; expiresAt: Date } | null;
	/** Persist rotated tokens, preserving all other stored fields for the service. */
	saveTokens(
		service: S,
		tokens: { accessToken: string; refreshToken: string; expiresIn: number }
	): void;
	deleteAuth(service: S): void;
	refreshToken(service: S, refreshToken: string): Promise<TokenRefreshResult>;
	fetchFn?: typeof fetch;
}

export function createAuthCore<S extends string>(deps: AuthCoreDeps<S>) {
	const fetchFn = deps.fetchFn ?? fetch;

	// Guard against concurrent refresh requests for the same service
	const refreshPromises = new Map<S, Promise<string | null>>();

	async function doRefresh(service: S): Promise<string | null> {
		const auth = deps.getAuth(service);
		if (!auth) return null;

		try {
			const result = await deps.refreshToken(service, auth.refreshToken);
			deps.saveTokens(service, {
				accessToken: result.access_token,
				// Some token endpoints omit refresh_token on refresh — keep the old one.
				refreshToken: result.refresh_token ?? auth.refreshToken,
				expiresIn: result.expires_in,
			});
			return result.access_token;
		} catch (err) {
			console.error(`Token refresh failed for ${service}:`, err);
			// Only wipe credentials when the token endpoint definitively rejected
			// the refresh token (4xx other than 429). Network errors, 5xx, and rate
			// limits are transient — keep the stored auth and retry on a later call,
			// otherwise a single offline poll (e.g. wake from sleep) logs the user out.
			const permanent =
				err instanceof TokenEndpointError &&
				err.status >= 400 &&
				err.status < 500 &&
				err.status !== 429;
			if (permanent) {
				deps.deleteAuth(service);
			}
			return null;
		}
	}

	/** Refresh now (deduplicated per service), regardless of local expiry. */
	function forceRefresh(service: S): Promise<string | null> {
		const existing = refreshPromises.get(service);
		if (existing) return existing;

		const promise = doRefresh(service).finally(() => {
			refreshPromises.delete(service);
		});
		refreshPromises.set(service, promise);
		return promise;
	}

	/**
	 * Returns a valid access token for the given service.
	 * Refreshes automatically if expired. Returns null if not connected.
	 * Deduplicates concurrent refresh calls per service.
	 */
	async function getValidToken(service: S): Promise<string | null> {
		const auth = deps.getAuth(service);
		if (!auth) return null;

		// Token still valid — return it
		const now = new Date();
		const bufferMs = 60_000;
		if (auth.expiresAt.getTime() - now.getTime() > bufferMs) {
			return auth.accessToken;
		}

		return forceRefresh(service);
	}

	/**
	 * Authenticated fetch — adds Bearer token, refreshes if needed.
	 * Throws if not connected or refresh fails.
	 * On a 401 API response, force-refreshes the token and retries once before
	 * treating the session as dead — the local expiresAt can drift from the
	 * server's view, and a revoked access token is recoverable via refresh.
	 */
	async function authFetch(service: S, url: string, init?: RequestInit): Promise<Response> {
		const token = await getValidToken(service);
		if (!token) {
			throw new Error(`Not connected to ${service}`);
		}

		const doFetch = (accessToken: string) =>
			fetchFn(url, {
				...init,
				headers: {
					...init?.headers,
					Authorization: `Bearer ${accessToken}`,
					Accept: "application/json",
				},
			});

		let res = await doFetch(token);

		if (res.status === 401) {
			const fresh = await forceRefresh(service);
			if (!fresh) {
				// doRefresh already deleted auth if the refresh token is dead;
				// on transient failure the stored auth survives for the next attempt.
				throw new Error(`${service} authentication temporarily unavailable`);
			}
			res = await doFetch(fresh);
			if (res.status === 401) {
				deps.deleteAuth(service);
				throw new Error(`${service} session expired. Please reconnect.`);
			}
		}

		return res;
	}

	return { getValidToken, forceRefresh, authFetch };
}
