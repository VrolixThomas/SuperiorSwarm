import "./preload-electron-mock";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { _setDbForTesting } from "../src/main/db";
import {
	getHermesConnectionWithToken,
	saveHermesConnectionWithDiscovery,
} from "../src/main/hermes/hermes-connections";
import {
	discoverHermesDashboardToken,
	extractInjectedHermesDashboardToken,
} from "../src/main/hermes/hermes-dashboard-token";
import { HermesTokenVault } from "../src/main/hermes/hermes-token-vault";
import { makeTestDb } from "./test-db";

describe("stock Hermes dashboard token discovery", () => {
	let vault: HermesTokenVault;

	beforeEach(() => {
		_setDbForTesting(makeTestDb());
		vault = new HermesTokenVault({
			isEncryptionAvailable: () => true,
			encryptString: (value) => Buffer.from(`encrypted:${value}`),
			decryptString: (value) => value.toString().replace(/^encrypted:/, ""),
		});
	});

	afterEach(() => {
		_setDbForTesting(null);
	});

	test("parses only the injected JSON string and rejects missing or malformed values", () => {
		expect(
			extractInjectedHermesDashboardToken(
				'<script>window.__HERMES_SESSION_TOKEN__ = "served-token\\u002dvalue";</script>'
			)
		).toBe("served-token-value");
		expect(() =>
			extractInjectedHermesDashboardToken(
				'<script>window.__HERMES_SESSION_TOKEN__ = {"token":"not-a-string"}</script>'
			)
		).toThrow("valid session token");
		expect(() =>
			extractInjectedHermesDashboardToken(
				'<script>window.__HERMES_SESSION_TOKEN__ = "unterminated</script>'
			)
		).toThrow("valid session token");
		expect(() => extractInjectedHermesDashboardToken("<html>no injection</html>")).toThrow(
			"valid session token"
		);
	});

	test("fetches only the loopback dashboard root with a bounded timeout", async () => {
		const requests: Array<{ url: string; redirect: RequestRedirect | undefined }> = [];
		const token = await discoverHermesDashboardToken("ws://localhost:8080/api/ws", {
			fetchImpl: async (input, init) => {
				requests.push({ url: String(input), redirect: init?.redirect });
				return new Response(
					'<script>window.__HERMES_SESSION_TOKEN__ = "served-from-stock";</script>'
				);
			},
			timeoutMs: 25,
		});

		expect(token).toBe("served-from-stock");
		expect(requests).toEqual([{ url: "http://localhost:8080/", redirect: "error" }]);
		await expect(
			discoverHermesDashboardToken("https://hermes.example.com", {
				fetchImpl: async () => new Response("should not fetch"),
			})
		).rejects.toThrow("loopback");

		await expect(
			discoverHermesDashboardToken("http://127.0.0.1:8080", {
				timeoutMs: 5,
				fetchImpl: async (_input, init) =>
					await new Promise<Response>((_resolve, reject) => {
						init?.signal?.addEventListener(
							"abort",
							() => reject(new DOMException("served-secret-must-not-leak", "AbortError")),
							{ once: true }
						);
					}),
			})
		).rejects.toThrow("timed out");
	});

	test("discovers and encrypts loopback auth without returning the resolved token", async () => {
		const connection = await saveHermesConnectionWithDiscovery(
			{
				label: "Local Hermes",
				baseUrl: "http://127.0.0.1:8080",
				profileId: "default",
			},
			vault,
			async () => "served-main-only-token"
		);

		expect(connection).toMatchObject({ connectionMode: "loopback", hasToken: true });
		expect(JSON.stringify(connection)).not.toContain("served-main-only-token");
		expect(getHermesConnectionWithToken(connection.id, vault)?.token).toBe(
			"served-main-only-token"
		);
	});

	test("never auto-discovers remote auth and requires an explicit remote token", async () => {
		let discoveries = 0;
		await expect(
			saveHermesConnectionWithDiscovery(
				{
					label: "Remote Hermes",
					baseUrl: "https://hermes.example.com",
					profileId: "default",
				},
				vault,
				async () => {
					discoveries++;
					return "wrong-token";
				}
			)
		).rejects.toThrow("explicit token");
		expect(discoveries).toBe(0);
	});

	test("never reuses a stored loopback token after changing the connection to remote", async () => {
		const local = await saveHermesConnectionWithDiscovery(
			{
				label: "Local Hermes",
				baseUrl: "http://127.0.0.1:8080",
				profileId: "default",
			},
			vault,
			async () => "loopback-only-token"
		);

		await expect(
			saveHermesConnectionWithDiscovery(
				{
					id: local.id,
					label: "Remote Hermes",
					baseUrl: "https://hermes.example.com",
					profileId: "default",
				},
				vault,
				async () => "must-not-run"
			)
		).rejects.toThrow("explicit token");
	});
});
