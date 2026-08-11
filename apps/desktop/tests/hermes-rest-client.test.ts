import { describe, expect, test } from "bun:test";
import { HermesRestClient, HermesRestError } from "../src/main/hermes/hermes-rest-client";
import { stockNumericMessageRows } from "./fixtures/hermes-stock";

function json(value: unknown, status = 200): Response {
	return new Response(JSON.stringify(value), {
		status,
		headers: { "content-type": "application/json" },
	});
}

describe("HermesRestClient", () => {
	test("polls a cheap session revision and fetches only the latest transcript page", async () => {
		const requests: URL[] = [];
		const client = new HermesRestClient({
			baseUrl: "http://localhost:9119",
			profileId: "work",
			token: "token",
			fetchImpl: async (input) => {
				const url = new URL(String(input));
				requests.push(url);
				const limit = Number(url.searchParams.get("limit"));
				const data = [
					{ id: 41, role: "user", content: "New question", timestamp: 123 },
					{ id: 42, role: "assistant", content: "New answer", timestamp: 124 },
				];
				return json({
					session_id: "stored-slack",
					view: "durable",
					data: limit === 1 ? data.slice(-1) : data,
					pagination: {
						limit,
						offset: 0,
						returned: limit === 1 ? 1 : 2,
						total: 42,
						order: "latest",
					},
				});
			},
		});

		expect(await client.getSessionRevision("stored-slack", "work")).toEqual({
			durableSessionId: "stored-slack",
			latestMessageId: "42",
			latestMessageAt: 124_000,
			latestMessageIdIsStable: true,
		});
		const tail = await client.getTranscriptTail("stored-slack", "work", 100);
		expect(tail.messages.map((entry) => entry.id)).toEqual(["41", "42"]);
		expect(tail.total).toBe(42);
		expect(tail.complete).toBe(false);
		expect(tail.messageIdsAreStable).toBe(true);
		expect(requests[0]?.pathname).toEndWith("/messages");
		expect(requests[0]?.searchParams.get("limit")).toBe("1");
		expect(requests[1]?.searchParams.get("limit")).toBe("100");
		expect(requests[1]?.searchParams.get("offset")).toBe("0");
		expect(requests[1]?.searchParams.get("order")).toBe("latest");
		expect(requests[1]?.searchParams.get("view")).toBe("durable");
	});

	test("never exposes a positional fallback ID as a stable revision anchor", async () => {
		const client = new HermesRestClient({
			baseUrl: "http://localhost:9119",
			profileId: "work",
			token: "token",
			fetchImpl: async () =>
				json({
					session_id: "stored-slack",
					view: "durable",
					messages: [{ role: "assistant", content: "No physical ID", timestamp: 124 }],
					pagination: { total: 12, has_more: true },
				}),
		});

		expect(await client.getSessionRevision("stored-slack", "work")).toEqual({
			durableSessionId: "stored-slack",
			latestMessageId: null,
			latestMessageAt: 124_000,
			latestMessageIdIsStable: false,
		});
		expect((await client.getTranscript("stored-slack", "work")).messageIdsAreStable).toBe(false);
	});

	test("marks only authoritative terminal tail pages complete", async () => {
		let requestCount = 0;
		const client = new HermesRestClient({
			baseUrl: "http://localhost:9119",
			profileId: "work",
			token: "token",
			fetchImpl: async () => {
				requestCount++;
				return json({
					session_id: "stored-slack",
					view: "durable",
					messages: [{ id: `physical-${requestCount}`, role: "assistant", content: "Row" }],
					...(requestCount === 2 ? { pagination: { has_more: false } } : {}),
				});
			},
		});

		expect((await client.getTranscriptTail("stored-slack", "work", 500)).complete).toBe(false);
		expect((await client.getTranscriptTail("stored-slack", "work", 500)).complete).toBe(true);
	});

	test("archives and permanently deletes through the encoded stock session route and profile", async () => {
		const requests: Array<{ url: URL; init: RequestInit | undefined }> = [];
		const client = new HermesRestClient({
			baseUrl: "http://127.0.0.1:9119/dashboard/",
			profileId: "default",
			token: "main-owned-secret",
			fetchImpl: async (input, init) => {
				requests.push({ url: new URL(String(input)), init });
				return new Response(null, { status: 204 });
			},
		});

		await client.setSessionArchived("folder/session #1", "work profile", true);
		await client.deleteSession("folder/session #1", "work profile");

		expect(requests).toHaveLength(2);
		for (const request of requests) {
			expect(request.url.pathname).toBe("/dashboard/api/sessions/folder%2Fsession%20%231");
			expect(request.url.searchParams.get("profile")).toBe("work profile");
			expect(new Headers(request.init?.headers).get("X-Hermes-Session-Token")).toBe(
				"main-owned-secret"
			);
		}
		expect(requests[0]?.init?.method).toBe("PATCH");
		expect(new Headers(requests[0]?.init?.headers).get("Content-Type")).toBe("application/json");
		expect(requests[0]?.init?.body).toBe(JSON.stringify({ archived: true }));
		expect(requests[1]?.init?.method).toBe("DELETE");
		expect(requests[1]?.init?.body).toBeUndefined();
	});

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
		expect(requests[0]?.url.searchParams.get("recents_exclude")).toContain("tool");
		expect(requests[0]?.url.searchParams.get("messaging_exclude")).toContain("superiorswarm");
		expect(requests[0]?.url.searchParams.get("messaging_exclude")).toContain("desktop");
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

	test("paginates stock transcript pages through the resolved compression tip", async () => {
		const requests: URL[] = [];
		const firstPage = Array.from({ length: 500 }, (_, index) => ({
			id: `old-${index}`,
			role: "assistant",
			content: `old ${index}`,
		}));
		const client = new HermesRestClient({
			baseUrl: "http://localhost:9119",
			profileId: "work",
			token: "token",
			fetchImpl: async (input) => {
				const url = new URL(String(input));
				requests.push(url);
				expect(url.searchParams.get("profile")).toBe("work");
				expect(url.searchParams.get("limit")).toBe("500");
				expect(url.searchParams.get("view")).toBe("durable");
				expect(url.searchParams.get("order")).toBe("oldest");
				return requests.length === 1
					? json({ session_id: "compressed-tip", view: "durable", messages: firstPage })
					: json({
							session_id: "compressed-tip",
							view: "durable",
							messages: [{ id: "newest", role: "user", content: "last" }],
						});
			},
		});

		const history = await client.getTranscript("compression-root", "work");

		expect(requests.map((request) => Number(request.searchParams.get("offset")))).toEqual([0, 500]);
		expect(history.durableSessionId).toBe("compressed-tip");
		expect(history.view).toBe("durable");
		expect(history.messageIdsAreStable).toBe(true);
		expect(history.compressionLineage).toEqual({
			kind: "compression",
			parentDurableSessionId: "compression-root",
			childDurableSessionId: "compressed-tip",
			verifiedBy: "durable-transcript",
		});
		expect(history.messages).toHaveLength(501);
		expect(history.messages[0]?.id).toBe("old-0");
		expect(history.messages.at(-1)?.id).toBe("newest");
	});

	test("rejects a durable transcript whose compression tip changes between pages", async () => {
		let requestCount = 0;
		const client = new HermesRestClient({
			baseUrl: "http://localhost:9119",
			profileId: "work",
			token: "token",
			fetchImpl: async () => {
				requestCount++;
				return requestCount === 1
					? json({
							session_id: "compression-child-a",
							view: "durable",
							messages: Array.from({ length: 500 }, (_, index) => ({
								id: `message-${index}`,
								role: "assistant",
								content: String(index),
							})),
						})
					: json({
							session_id: "compression-child-b",
							view: "durable",
							messages: [],
						});
			},
		});

		await expect(client.getTranscript("compression-parent", "work")).rejects.toThrow(
			"changed the durable compression tip"
		);
	});

	test("accepts the gateway data envelope for durable transcript rows", async () => {
		const client = new HermesRestClient({
			baseUrl: "http://localhost:9119",
			profileId: "work",
			token: "token",
			fetchImpl: async () =>
				json({
					object: "list",
					session_id: "gateway-session",
					view: "durable",
					data: [
						{ id: 41, role: "user", content: "Question" },
						{ id: 42, role: "assistant", content: "Answer" },
					],
					pagination: { limit: 500, offset: 0, returned: 2, order: "oldest" },
				}),
		});

		const history = await client.getTranscript("gateway-session", "work");

		expect(history.view).toBe("durable");
		expect(history.messageIdsAreStable).toBe(true);
		expect(history.messages.map((message) => [message.id, message.text])).toEqual([
			["41", "Question"],
			["42", "Answer"],
		]);
	});

	test("stops durable pagination on a short physical page despite legacy has_more", async () => {
		let requestCount = 0;
		const client = new HermesRestClient({
			baseUrl: "http://localhost:9119",
			profileId: "work",
			token: "token",
			fetchImpl: async () => {
				requestCount += 1;
				return json({
					session_id: "durable-short-page",
					view: "durable",
					messages: [{ id: "only-row", role: "assistant", content: "Done" }],
					pagination: { offset: 0, returned: 1, has_more: true },
				});
			},
		});

		const history = await client.getTranscript("durable-short-page", "work");

		expect(requestCount).toBe(1);
		expect(history.messages.map((message) => message.id)).toEqual(["only-row"]);
	});

	test("uses actual rows rather than advertised returned counts for active and durable offsets", async () => {
		const durableOffsets: number[] = [];
		const durable = new HermesRestClient({
			baseUrl: "http://localhost:9119",
			profileId: "work",
			token: "token",
			fetchImpl: async (input) => {
				const url = new URL(String(input));
				const offset = Number(url.searchParams.get("offset"));
				durableOffsets.push(offset);
				const messages = Array.from({ length: offset === 0 ? 500 : 1 }, (_, index) => ({
					id: `durable-${offset + index}`,
					role: "assistant",
					content: "row",
				}));
				return json({
					session_id: "durable-offsets",
					view: "durable",
					messages,
					pagination: { offset, returned: offset === 0 ? 7 : 900 },
				});
			},
		});

		expect((await durable.getTranscript("durable-offsets", "work")).messages).toHaveLength(501);
		expect(durableOffsets).toEqual([0, 500]);

		const activeOffsets: number[] = [];
		const active = new HermesRestClient({
			baseUrl: "http://localhost:9119",
			profileId: "work",
			token: "token",
			fetchImpl: async (input) => {
				const url = new URL(String(input));
				const offset = Number(url.searchParams.get("offset"));
				if (url.searchParams.has("view")) {
					return json({ session_id: "active-offsets", messages: [] });
				}
				activeOffsets.push(offset);
				return json({
					session_id: "active-offsets",
					messages: [{ id: `active-${offset}`, role: "assistant", content: "row" }],
					pagination: { offset, returned: 500, has_more: offset === 0 },
				});
			},
		});

		expect((await active.getTranscript("active-offsets", "work")).messages).toHaveLength(2);
		expect(activeOffsets).toEqual([0, 1]);
	});

	test("rejects zero-row pagination that claims more data in active and durable views", async () => {
		for (const silentlyOld of [false, true]) {
			let requestCount = 0;
			const client = new HermesRestClient({
				baseUrl: "http://localhost:9119",
				profileId: "work",
				token: "token",
				maxTranscriptPages: 3,
				fetchImpl: async (input) => {
					requestCount += 1;
					const url = new URL(String(input));
					if (silentlyOld && url.searchParams.has("view")) {
						return json({ session_id: "zero-active", messages: [] });
					}
					return json({
						session_id: silentlyOld ? "zero-active" : "zero-durable",
						...(silentlyOld ? {} : { view: "durable" }),
						messages: [],
						pagination: { offset: 0, returned: 0, has_more: true },
					});
				},
			});

			await expect(
				client.getTranscript(silentlyOld ? "zero-active" : "zero-durable", "work")
			).rejects.toMatchObject({ kind: "malformed-response" });
			expect(requestCount).toBe(silentlyOld ? 2 : 1);
		}
	});

	test("accepts an exact full terminal page at a one-page bound for active and durable views", async () => {
		const fullPage = Array.from({ length: 500 }, (_, index) => ({
			id: `row-${index}`,
			role: "assistant",
			content: "row",
		}));
		const durable = new HermesRestClient({
			baseUrl: "http://localhost:9119",
			profileId: "work",
			token: "token",
			maxTranscriptPages: 1,
			fetchImpl: async () =>
				json({
					session_id: "terminal-durable",
					view: "durable",
					messages: fullPage,
					pagination: { offset: 0, returned: 500, has_more: false },
				}),
		});
		expect((await durable.getTranscript("terminal-durable", "work")).messages).toHaveLength(500);

		const active = new HermesRestClient({
			baseUrl: "http://localhost:9119",
			profileId: "work",
			token: "token",
			maxTranscriptPages: 1,
			fetchImpl: async (input) => {
				const url = new URL(String(input));
				return url.searchParams.has("view")
					? json({ session_id: "terminal-active", messages: [] })
					: json({
							session_id: "terminal-active",
							messages: fullPage,
							pagination: { offset: 0, returned: 500, total: 500 },
						});
			},
		});
		expect((await active.getTranscript("terminal-active", "work")).messages).toHaveLength(500);
	});

	test("keeps the transcript page bound for a non-terminal exact full durable page", async () => {
		const client = new HermesRestClient({
			baseUrl: "http://localhost:9119",
			profileId: "work",
			token: "token",
			maxTranscriptPages: 1,
			fetchImpl: async () =>
				json({
					session_id: "bounded-durable",
					view: "durable",
					messages: Array.from({ length: 500 }, (_, index) => ({
						id: `row-${index}`,
						role: "assistant",
						content: "row",
					})),
				}),
		});

		await expect(client.getTranscript("bounded-durable", "work")).rejects.toMatchObject({
			kind: "transcript-too-large",
		});
	});

	test("preserves numeric message IDs and stock insertion order across 501-row pages", async () => {
		const offsets: number[] = [];
		const client = new HermesRestClient({
			baseUrl: "http://localhost:9119",
			profileId: "work",
			token: "token",
			fetchImpl: async (input) => {
				const url = new URL(String(input));
				const offset = Number(url.searchParams.get("offset"));
				offsets.push(offset);
				expect(url.searchParams.get("order")).toBe("oldest");
				expect(url.searchParams.get("view")).toBe("durable");
				const messages = stockNumericMessageRows.slice(offset, offset + 500);
				return json({
					session_id: "stored-numeric-history",
					view: "durable",
					messages,
					pagination: { limit: 500, offset, returned: messages.length },
				});
			},
		});

		const history = await client.getTranscript("stored-numeric-history", "work");

		expect(offsets).toEqual([0, 500]);
		expect(history.messages).toHaveLength(501);
		expect(history.messages.map((message) => message.id)).toEqual(
			stockNumericMessageRows.map((message) => String(message.id))
		);
		expect(history.messages.map((message) => message.text)).toEqual(
			stockNumericMessageRows.map((message) => message.content)
		);
	});

	test("uses active pagination when an old backend silently ignores durable view", async () => {
		const requests: Array<{ offset: number; view: string | null }> = [];
		const client = new HermesRestClient({
			baseUrl: "http://localhost:9119",
			profileId: "work",
			token: "token",
			fetchImpl: async (input) => {
				const url = new URL(String(input));
				const request = {
					offset: Number(url.searchParams.get("offset")),
					view: url.searchParams.get("view"),
				};
				requests.push(request);
				if (request.view === "durable") {
					return json({
						session_id: "stored-1",
						messages: [{ id: "ignored-active-row", role: "system", content: "Active only" }],
					});
				}
				return request.offset === 0
					? json({
							session_id: "stored-1",
							messages: [{ id: "older", role: "user", content: "first" }],
							pagination: { offset: 0, returned: 1, has_more: true },
						})
					: json({
							session_id: "stored-1",
							messages: [{ id: "newer", role: "assistant", content: "second" }],
							pagination: { offset: 1, returned: 1, has_more: false },
						});
			},
		});

		const history = await client.getTranscript("stored-1", "work");

		expect(requests).toEqual([
			{ offset: 0, view: "durable" },
			{ offset: 0, view: null },
			{ offset: 1, view: null },
		]);
		expect(history.view).toBe("active");
		expect(history.messages.map((message) => message.id)).toEqual(["older", "newer"]);
	});

	test("falls back to active history when an old backend explicitly rejects durable view", async () => {
		const requests: URL[] = [];
		const client = new HermesRestClient({
			baseUrl: "http://localhost:9119",
			profileId: "work",
			token: "token",
			fetchImpl: async (input) => {
				const url = new URL(String(input));
				requests.push(url);
				if (requests.length === 1) {
					return json({ error: { message: "unknown query parameter `view`" } }, 400);
				}
				return json({
					session_id: "stored-old",
					messages: [{ id: "active-only", role: "assistant", content: "Current context" }],
				});
			},
		});

		const history = await client.getTranscript("stored-old", "work");

		expect(requests).toHaveLength(2);
		expect(requests[0]?.searchParams.get("view")).toBe("durable");
		expect(requests[1]?.searchParams.has("view")).toBe(false);
		expect(requests[1]?.searchParams.has("order")).toBe(false);
		expect(history.view).toBe("active");
		expect(history.messages.map((message) => message.id)).toEqual(["active-only"]);
	});

	test("does not downgrade invalid durable offsets or unrelated view validation errors", async () => {
		for (const [status, body] of [
			[400, { detail: "invalid offset for durable view" }],
			[422, { detail: "invalid value for view" }],
			[
				422,
				{
					detail: [
						{
							type: "extra_forbidden",
							loc: ["query", "offset"],
							msg: "Extra inputs are not permitted for view",
						},
					],
				},
			],
		] as const) {
			let requestCount = 0;
			const client = new HermesRestClient({
				baseUrl: "http://localhost:9119",
				profileId: "work",
				token: "token",
				fetchImpl: async () => {
					requestCount += 1;
					return json(body, status);
				},
			});

			await expect(client.getTranscript("stored-error", "work")).rejects.toMatchObject({
				status,
			});
			expect(requestCount).toBe(1);
		}
	});

	test("falls back when strict old FastAPI rejects the unknown view query field", async () => {
		let requestCount = 0;
		const client = new HermesRestClient({
			baseUrl: "http://localhost:9119",
			profileId: "work",
			token: "token",
			fetchImpl: async () => {
				requestCount += 1;
				return requestCount === 1
					? json(
							{
								detail: [
									{
										type: "extra_forbidden",
										loc: ["query", "view"],
										msg: "Extra inputs are not permitted",
									},
								],
							},
							422
						)
					: json({
							session_id: "stored-strict-old",
							messages: [{ id: "active-row", role: "assistant", content: "Active context" }],
						});
			},
		});

		const history = await client.getTranscript("stored-strict-old", "work");

		expect(requestCount).toBe(2);
		expect(history.view).toBe("active");
	});

	test("requires an exact FastAPI query/view rejection before falling back", async () => {
		for (const detail of [
			[
				{
					type: "extra_forbidden",
					loc: ["body", "view"],
					msg: "Extra inputs are not permitted",
				},
			],
			[
				{
					type: "value_error",
					loc: ["query", "view"],
					msg: "Unknown value",
				},
			],
		] as const) {
			let requestCount = 0;
			const client = new HermesRestClient({
				baseUrl: "http://localhost:9119",
				profileId: "work",
				token: "token",
				fetchImpl: async () => {
					requestCount += 1;
					return json({ detail }, 422);
				},
			});

			await expect(client.getTranscript("stored-strict", "work")).rejects.toMatchObject({
				status: 422,
			});
			expect(requestCount).toBe(1);
		}
	});

	test("does not treat a malformed or unknown-view durable response as an old backend", async () => {
		for (const payload of [
			{ messages: [{ id: "row", role: "assistant", content: "Missing session" }] },
			{
				session_id: "stored-unknown-view",
				view: "experimental",
				messages: [{ id: "row", role: "assistant", content: "Unknown view" }],
			},
		] as const) {
			let requestCount = 0;
			const client = new HermesRestClient({
				baseUrl: "http://localhost:9119",
				profileId: "work",
				token: "token",
				fetchImpl: async () => {
					requestCount += 1;
					return json(payload);
				},
			});

			await expect(client.getTranscript("stored-malformed", "work")).rejects.toMatchObject({
				kind: "malformed-response",
			});
			expect(requestCount).toBe(1);
		}
	});

	test("does not hide unrelated client, authentication, network, or server failures", async () => {
		for (const [status, body] of [
			[400, { error: { code: "invalid_pagination", message: "invalid offset" } }],
			[401, { error: { code: "unauthorized", message: "invalid token" } }],
			[500, { error: { code: "server_error", message: "backend unavailable" } }],
		] as const) {
			let requestCount = 0;
			const client = new HermesRestClient({
				baseUrl: "http://localhost:9119",
				profileId: "work",
				token: "token",
				fetchImpl: async () => {
					requestCount += 1;
					return json(body, status);
				},
			});

			await expect(client.getTranscript("stored-error", "work")).rejects.toMatchObject({
				status,
			});
			expect(requestCount).toBe(1);
		}

		let networkRequests = 0;
		const network = new HermesRestClient({
			baseUrl: "http://localhost:9119",
			profileId: "work",
			token: "token",
			fetchImpl: async () => {
				networkRequests += 1;
				throw new Error("connection refused");
			},
		});
		await expect(network.getTranscript("stored-error", "work")).rejects.toMatchObject({
			kind: "network",
		});
		expect(networkRequests).toBe(1);
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
