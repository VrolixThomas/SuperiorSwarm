import { expect, test } from "bun:test";
import { inIsolatedFileBrowserTest } from "./helpers/isolated-file-browser-test";

if (inIsolatedFileBrowserTest(import.meta.path, "actual DB credential generation races")) {
	const { makeTestDb } = await import("./test-db");
	const { _setDbForTesting } = await import("../src/main/db");
	const originalFetch = globalThis.fetch;
	const responses: Array<(response: Response) => void> = [];
	globalThis.fetch = (async () =>
		new Promise<Response>((resolve) => responses.push(resolve))) as unknown as typeof fetch;
	const auth = await import("../src/main/atlassian/auth");
	const response = (value: string) =>
		new Response(
			JSON.stringify({
				access_token: `synthetic-${value}`,
				refresh_token: `synthetic-refresh-${value}`,
				expires_in: 3600,
			})
		);
	for (const service of ["bitbucket", "jira"] as const) {
		for (const replacement of [
			"account",
			"disconnect",
			"same-credentials",
			"rotation",
			"invalid-grant",
			"new-refresh",
		] as const) {
			test(`${service}: ${replacement} fences persistence and returned credentials`, async () => {
				_setDbForTesting(makeTestDb());
				responses.length = 0;
				const save = (id: string, expiresIn = -1) =>
					auth.saveAuth({
						service,
						accountId: id,
						accessToken: `synthetic-${id}`,
						refreshToken: `synthetic-refresh-${id}`,
						expiresIn,
						cloudId: `${id}-cloud`,
						displayName: id,
					});
				try {
					save("A");
					const initial = auth.getAuth(service);
					const pending = auth.getValidToken(service);
					expect(responses).toHaveLength(1);
					if (replacement === "disconnect") auth.deleteAuth(service);
					else if (replacement === "same-credentials") {
						auth.deleteAuth(service);
						save("A");
					} else if (replacement === "rotation")
						auth.saveAuth({
							service,
							accountId: "A",
							accessToken: "synthetic-rotated",
							refreshToken: "synthetic-rotated-refresh",
							expiresIn: 3600,
						});
					else save("B", replacement === "new-refresh" ? -1 : 3600);
					const current = auth.getAuth(service);
					expect(current?.credentialVersion === initial?.credentialVersion).toBe(false);
					let newer: Promise<string | null> | undefined;
					if (replacement === "new-refresh") {
						newer = auth.getValidToken(service);
						expect(responses).toHaveLength(2);
					}
					responses[0]?.(
						replacement === "invalid-grant"
							? new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 })
							: response("A-late")
					);
					expect(await pending).toBeNull();
					expect(auth.getAuth(service)?.credentialVersion).toBe(current?.credentialVersion);
					if (newer) {
						// Old finally must not evict B's in-flight dedup entry.
						const duplicate = auth.getValidToken(service);
						expect(responses).toHaveLength(2);
						responses[1]?.(response("B-refreshed"));
						expect((await newer) === "synthetic-B-refreshed").toBe(true);
						expect((await duplicate) === "synthetic-B-refreshed").toBe(true);
						expect(auth.getAuth(service)?.accountId).toBe("B");
						expect(auth.getAuth(service)?.cloudId).toBe("B-cloud");
					}
				} finally {
					_setDbForTesting(null);
				}
			});
		}
	}
	test("late API 401 cannot retry the old account request using replacement credentials", async () => {
		_setDbForTesting(makeTestDb());
		responses.length = 0;
		try {
			const save = (id: string) =>
				auth.saveAuth({
					service: "bitbucket",
					accountId: id,
					accessToken: `synthetic-${id}`,
					refreshToken: `synthetic-refresh-${id}`,
					expiresIn: 3600,
				});
			save("A");
			const pending = auth.atlassianFetch("bitbucket", "https://synthetic.invalid/resource");
			await Promise.resolve();
			expect(responses).toHaveLength(1);
			save("B");
			responses[0]?.(new Response(null, { status: 401 }));
			await expect(pending).rejects.toThrow("connection changed");
			expect(responses).toHaveLength(1);
			expect(auth.getAuth("bitbucket")?.accountId).toBe("B");
		} finally {
			_setDbForTesting(null);
		}
	});
	const { afterAll } = await import("bun:test");
	afterAll(() => {
		globalThis.fetch = originalFetch;
	});
}
