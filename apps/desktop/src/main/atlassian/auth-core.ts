/**
 * Pure token-lifecycle logic for Atlassian OAuth services, decoupled from
 * Electron, the database, and global fetch so it can be unit-tested directly.
 * `auth.ts` wires it to the real store and token endpoints.
 */

/**
 * Error from the OAuth token endpoint itself. Carries the provider error code
 * so the refresh flow can distinguish `invalid_grant` from configuration,
 * permission, rate-limit, and transient failures.
 */
export class TokenEndpointError extends Error {
	constructor(
		readonly status: number,
		message: string,
		readonly oauthError?: string
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
	/**
	 * Delete credentials only when they still contain the refresh token used by
	 * this request. Another app process may have rotated and stored a replacement
	 * while this refresh was in flight.
	 */
	deleteAuthIfRefreshTokenMatches(service: S, refreshToken: string): void;
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
			// `invalid_grant` specifically means the refresh token is no longer
			// usable. Other 4xx responses can be an app configuration, scope, or
			// provider problem and must not silently disconnect the user.
			if (err instanceof TokenEndpointError && err.oauthError === "invalid_grant") {
				deps.deleteAuthIfRefreshTokenMatches(service, auth.refreshToken);
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
	 * On a 401 API response, force-refreshes the token and retries once. A second
	 * 401 can also mean the token lacks permission for that particular endpoint,
	 * so it must not erase otherwise valid credentials.
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
				throw new Error(
					`${service} request remained unauthorized after refreshing. The endpoint may require additional permissions.`
				);
			}
		}

		return res;
	}

	return { getValidToken, forceRefresh, authFetch };
}
