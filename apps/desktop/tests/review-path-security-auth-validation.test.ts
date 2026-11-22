import { expect, test } from "bun:test";
import { inIsolatedFileBrowserTest } from "./helpers/isolated-file-browser-test";

if (
	inIsolatedFileBrowserTest(
		import.meta.path,
		"V3 actual Bitbucket auth persistence with isolated synthetic accounts"
	)
) {
	const { Database } = await import("bun:sqlite");
	const { drizzle } = await import("drizzle-orm/bun-sqlite");
	const { migrate } = await import("drizzle-orm/bun-sqlite/migrator");
	const { join } = await import("node:path");
	const schema = await import("../src/main/db/schema");
	const { _setDbForTesting } = await import("../src/main/db");
	test("V3: successful refresh from old account cannot overwrite a newly connected account", async () => {
		const sql = new Database(":memory:");
		const raw = drizzle(sql, { schema });
		migrate(raw, { migrationsFolder: join(import.meta.dir, "../src/main/db/migrations") });
		_setDbForTesting(raw as unknown as ReturnType<typeof import("../src/main/db").getDb>);
		const originalFetch = globalThis.fetch;
		let release!: () => void;
		let entered!: () => void;
		const requested = new Promise<void>((resolve) => {
			entered = resolve;
		});
		globalThis.fetch = (async () => {
			entered();
			await new Promise<void>((resolve) => {
				release = resolve;
			});
			return new Response(
				JSON.stringify({
					access_token: "synthetic-A-refreshed",
					refresh_token: "synthetic-A-refresh-2",
					expires_in: 3600,
				})
			);
		}) as unknown as typeof fetch;
		try {
			const auth = await import("../src/main/atlassian/auth");
			auth.saveAuth({
				service: "bitbucket",
				accountId: "A",
				accessToken: "synthetic-A",
				refreshToken: "synthetic-A-refresh",
				expiresIn: -1,
			});
			const pending = auth.getValidToken("bitbucket");
			await requested;
			auth.saveAuth({
				service: "bitbucket",
				accountId: "B",
				accessToken: "synthetic-B",
				refreshToken: "synthetic-B-refresh",
				expiresIn: 3600,
			});
			release();
			await pending;
			const current = auth.getAuth("bitbucket");
			expect(current?.accountId).toBe("B");
			// Compare booleans so failures do not print even synthetic token values.
			expect(current?.accessToken === "synthetic-B").toBe(true);
			expect(current?.refreshToken === "synthetic-B-refresh").toBe(true);
		} finally {
			globalThis.fetch = originalFetch;
			_setDbForTesting(null);
			sql.close();
		}
	});
}
