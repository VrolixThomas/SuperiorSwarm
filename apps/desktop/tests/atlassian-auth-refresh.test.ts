import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	type AuthCoreDeps,
	TokenEndpointError,
	type TokenRefreshResult,
	createAuthCore,
} from "../src/main/atlassian/auth-core";

type Service = "jira" | "bitbucket";

interface StoredAuth {
	accessToken: string;
	refreshToken: string;
	expiresAt: Date;
}

function makeHarness(opts: {
	auth?: StoredAuth | null;
	refresh?: (
		service: Service,
		refreshToken: string,
		store: Map<Service, StoredAuth>
	) => Promise<TokenRefreshResult>;
	fetchFn?: typeof fetch;
}) {
	const store = new Map<Service, StoredAuth>();
	if (opts.auth) store.set("bitbucket", opts.auth);

	const deps: AuthCoreDeps<Service> = {
		getAuth: (service) => store.get(service) ?? null,
		saveTokens: (service, tokens) => {
			store.set(service, {
				accessToken: tokens.accessToken,
				refreshToken: tokens.refreshToken,
				expiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
			});
		},
		deleteAuthIfRefreshTokenMatches: (service, refreshToken) => {
			if (store.get(service)?.refreshToken === refreshToken) {
				store.delete(service);
			}
		},
		refreshToken: async (service, refreshToken) => {
			if (!opts.refresh) throw new Error("refresh not expected in this test");
			return opts.refresh(service, refreshToken, store);
		},
		fetchFn: opts.fetchFn,
	};

	return { core: createAuthCore(deps), store };
}

function expiredAuth(): StoredAuth {
	return {
		accessToken: "old-access-token",
		refreshToken: "refresh-token-1",
		expiresAt: new Date(Date.now() - 3600_000),
	};
}

function validAuth(): StoredAuth {
	return {
		accessToken: "old-access-token",
		refreshToken: "refresh-token-1",
		expiresAt: new Date(Date.now() + 3600_000),
	};
}

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

// doRefresh logs expected failures; keep test output clean.
const realConsoleError = console.error;

beforeEach(() => {
	console.error = () => {};
});

afterEach(() => {
	console.error = realConsoleError;
});

describe("token refresh failure handling", () => {
	test("transient network error during refresh keeps stored auth", async () => {
		const { core, store } = makeHarness({
			auth: expiredAuth(),
			refresh: async () => {
				throw new TypeError("fetch failed");
			},
		});

		const token = await core.getValidToken("bitbucket");
		expect(token).toBeNull();
		// Connection must survive a transient failure — user should NOT be logged out.
		expect(store.get("bitbucket")).toBeDefined();
	});

	test("5xx from token endpoint keeps stored auth", async () => {
		const { core, store } = makeHarness({
			auth: expiredAuth(),
			refresh: async () => {
				throw new TokenEndpointError(503, "service unavailable");
			},
		});

		const token = await core.getValidToken("bitbucket");
		expect(token).toBeNull();
		expect(store.get("bitbucket")).toBeDefined();
	});

	test("429 from token endpoint keeps stored auth", async () => {
		const { core, store } = makeHarness({
			auth: expiredAuth(),
			refresh: async () => {
				throw new TokenEndpointError(429, "rate limited");
			},
		});

		const token = await core.getValidToken("bitbucket");
		expect(token).toBeNull();
		expect(store.get("bitbucket")).toBeDefined();
	});

	test("invalid_grant (400) from token endpoint deletes auth", async () => {
		const { core, store } = makeHarness({
			auth: expiredAuth(),
			refresh: async () => {
				throw new TokenEndpointError(400, "invalid_grant", "invalid_grant");
			},
		});

		const token = await core.getValidToken("bitbucket");
		expect(token).toBeNull();
		expect(store.get("bitbucket")).toBeUndefined();
	});

	test("other permanent token errors keep stored auth", async () => {
		const { core, store } = makeHarness({
			auth: expiredAuth(),
			refresh: async () => {
				throw new TokenEndpointError(401, "invalid_client", "invalid_client");
			},
		});

		const token = await core.getValidToken("bitbucket");
		expect(token).toBeNull();
		expect(store.get("bitbucket")).toBeDefined();
	});

	test("invalid_grant for a stale rotating token keeps newer auth", async () => {
		const harness = makeHarness({
			auth: expiredAuth(),
			refresh: async (_service, _refreshToken, store) => {
				store.set("bitbucket", {
					accessToken: "access-token-from-another-process",
					refreshToken: "refresh-token-2",
					expiresAt: new Date(Date.now() + 7200_000),
				});
				throw new TokenEndpointError(400, "invalid_grant", "invalid_grant");
			},
		});

		const token = await harness.core.getValidToken("bitbucket");
		expect(token).toBeNull();
		expect(harness.store.get("bitbucket")?.refreshToken).toBe("refresh-token-2");
	});

	test("successful refresh stores new tokens", async () => {
		const { core, store } = makeHarness({
			auth: expiredAuth(),
			refresh: async () => ({
				access_token: "new-access-token",
				refresh_token: "refresh-token-2",
				expires_in: 7200,
			}),
		});

		const token = await core.getValidToken("bitbucket");
		expect(token).toBe("new-access-token");
		expect(store.get("bitbucket")?.refreshToken).toBe("refresh-token-2");
	});

	test("refresh response without refresh_token keeps the old refresh token", async () => {
		const { core, store } = makeHarness({
			auth: expiredAuth(),
			refresh: async () => ({
				access_token: "new-access-token",
				expires_in: 7200,
			}),
		});

		const token = await core.getValidToken("bitbucket");
		expect(token).toBe("new-access-token");
		expect(store.get("bitbucket")?.refreshToken).toBe("refresh-token-1");
	});

	test("valid unexpired token is returned without refreshing", async () => {
		const { core } = makeHarness({ auth: validAuth() });

		const token = await core.getValidToken("bitbucket");
		expect(token).toBe("old-access-token");
	});

	test("concurrent refreshes are deduplicated", async () => {
		let refreshCalls = 0;
		const { core } = makeHarness({
			auth: expiredAuth(),
			refresh: async () => {
				refreshCalls++;
				await new Promise((r) => setTimeout(r, 10));
				return {
					access_token: "new-access-token",
					refresh_token: "refresh-token-2",
					expires_in: 7200,
				};
			},
		});

		const [a, b] = await Promise.all([
			core.getValidToken("bitbucket"),
			core.getValidToken("bitbucket"),
		]);
		expect(a).toBe("new-access-token");
		expect(b).toBe("new-access-token");
		expect(refreshCalls).toBe(1);
	});
});

describe("authFetch 401 handling", () => {
	test("retries once with refreshed token on API 401", async () => {
		let apiCalls = 0;
		const { core, store } = makeHarness({
			auth: validAuth(),
			refresh: async () => ({
				access_token: "new-access-token",
				refresh_token: "refresh-token-2",
				expires_in: 7200,
			}),
			fetchFn: (async (_url: string | URL | Request, init?: RequestInit) => {
				apiCalls++;
				const authHeader = (init?.headers as Record<string, string>)?.["Authorization"];
				if (authHeader === "Bearer new-access-token") {
					return jsonResponse(200, { ok: true });
				}
				return jsonResponse(401, { error: "expired" });
			}) as typeof fetch,
		});

		const res = await core.authFetch("bitbucket", "https://api.bitbucket.org/2.0/user");
		expect(res.status).toBe(200);
		expect(apiCalls).toBe(2);
		expect(store.get("bitbucket")).toBeDefined();
	});

	test("keeps auth when retry after refresh still 401", async () => {
		const { core, store } = makeHarness({
			auth: validAuth(),
			refresh: async () => ({
				access_token: "new-access-token",
				refresh_token: "refresh-token-2",
				expires_in: 7200,
			}),
			fetchFn: (async () => jsonResponse(401, { error: "revoked" })) as unknown as typeof fetch,
		});

		await expect(core.authFetch("bitbucket", "https://api.bitbucket.org/2.0/user")).rejects.toThrow(
			/additional permissions/i
		);
		expect(store.get("bitbucket")).toBeDefined();
	});

	test("keeps auth when API 401 but refresh fails transiently", async () => {
		const { core, store } = makeHarness({
			auth: validAuth(),
			refresh: async () => {
				throw new TypeError("fetch failed");
			},
			fetchFn: (async () => jsonResponse(401, { error: "expired" })) as unknown as typeof fetch,
		});

		await expect(core.authFetch("bitbucket", "https://api.bitbucket.org/2.0/user")).rejects.toThrow(
			/temporarily unavailable/i
		);
		// Transient refresh failure must not wipe the connection.
		expect(store.get("bitbucket")).toBeDefined();
	});

	test("throws not-connected when no auth stored", async () => {
		const { core } = makeHarness({ auth: null });

		await expect(core.authFetch("bitbucket", "https://api.bitbucket.org/2.0/user")).rejects.toThrow(
			/not connected/i
		);
	});
});
