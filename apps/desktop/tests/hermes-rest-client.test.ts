import { describe, expect, test } from "bun:test";
import { HermesRestClient, HermesRestError } from "../src/main/hermes/hermes-rest-client";

function json(value: unknown, status = 200): Response {
	return new Response(JSON.stringify(value), {
		status,
		headers: { "content-type": "application/json" },
	});
}

describe("HermesRestClient", () => {
	test("uses stock token auth, sidebar catalog, redacted DTOs, and recent ordering", async () => {
		const requests: Array<{ url: URL; headers: Headers }> = [];
		const client = new HermesRestClient({
			baseUrl: "http://127.0.0.1:9119",
			profileId: "work",
			token: "rest-secret",
			fetchImpl: async (input, init) => {
				requests.push({ url: new URL(String(input)), headers: new Headers(init?.headers) });
				return json({
					recents: {
						sessions: [
							{
								id: "older",
								profile: "default",
								title: "Older",
								last_active: 10,
								session_key: "agent:main:local",
							},
						],
					},
					messaging: {
						sessions: [
							{
								id: "newer",
								profile: "work",
								title: "Newer",
								source: "slack",
								last_active: 20,
								chat_id: "CSECRET",
								thread_id: "1786269600.123456",
								origin_json: { token: "origin-secret" },
							},
						],
					},
					cron: { sessions: [] },
				});
			},
		});

		const sessions = await client.listSessions();

		expect(requests[0]?.url.pathname).toBe("/api/profiles/sessions/sidebar");
		expect(requests[0]?.url.searchParams.get("recents_profile")).toBe("all");
		expect(requests[0]?.headers.get("X-Hermes-Session-Token")).toBe("rest-secret");
		expect(sessions.map((session) => session.id)).toEqual(["newer", "older"]);
		expect(JSON.stringify(sessions)).not.toContain("CSECRET");
		expect(JSON.stringify(sessions)).not.toContain("origin-secret");
	});

	test("falls back to the general stock profile catalog", async () => {
		const paths: string[] = [];
		const client = new HermesRestClient({
			baseUrl: "http://localhost:9119",
			profileId: "work",
			token: "token",
			fetchImpl: async (input) => {
				const url = new URL(String(input));
				paths.push(`${url.pathname}?${url.searchParams.toString()}`);
				if (url.pathname.endsWith("/sidebar")) return json({ detail: "missing" }, 404);
				return json({ sessions: [{ id: "session-1", profile: "work", last_active: 42 }] });
			},
		});

		expect((await client.listSessions())[0]?.id).toBe("session-1");
		expect(paths[1]).toContain("/api/profiles/sessions?");
		expect(paths[1]).toContain("profile=all");
		expect(paths[1]).toContain("order=recent");
	});

	test("paginates latest-first stock transcript pages and restores chronology", async () => {
		const offsets: number[] = [];
		const newest = Array.from({ length: 500 }, (_, index) => ({
			id: `new-${index}`,
			role: "assistant",
			content: `new ${index}`,
		}));
		const client = new HermesRestClient({
			baseUrl: "http://localhost:9119",
			profileId: "work",
			token: "token",
			fetchImpl: async (input) => {
				const url = new URL(String(input));
				offsets.push(Number(url.searchParams.get("offset")));
				expect(url.searchParams.get("profile")).toBe("work");
				expect(url.searchParams.get("limit")).toBe("500");
				expect(url.searchParams.get("order")).toBe("latest");
				return offsets.length === 1
					? json({ session_id: "compressed-tip", messages: newest })
					: json({
							session_id: "compressed-tip",
							messages: [{ id: "oldest", role: "user", content: "first" }],
						});
			},
		});

		const history = await client.getTranscript("compression-root", "work");

		expect(offsets).toEqual([0, 500]);
		expect(history.durableSessionId).toBe("compressed-tip");
		expect(history.messages).toHaveLength(501);
		expect(history.messages[0]?.id).toBe("oldest");
		expect(history.messages.at(-1)?.id).toBe("new-499");
	});

	test("maps HTTP and malformed responses to sanitized typed errors", async () => {
		const unauthorized = new HermesRestClient({
			baseUrl: "http://localhost:9119",
			profileId: "default",
			token: "top-secret",
			fetchImpl: async () => json({ detail: "token=top-secret" }, 401),
		});

		try {
			await unauthorized.listSessions();
			expect.unreachable("request should fail");
		} catch (error) {
			expect(error).toBeInstanceOf(HermesRestError);
			expect((error as HermesRestError).kind).toBe("unauthorized");
			expect((error as Error).message).not.toContain("top-secret");
		}

		const malformed = new HermesRestClient({
			baseUrl: "http://localhost:9119",
			profileId: "default",
			token: "token",
			fetchImpl: async () => new Response("not-json", { status: 200 }),
		});
		await expect(malformed.listSessions()).rejects.toMatchObject({ kind: "malformed-response" });
	});
});
