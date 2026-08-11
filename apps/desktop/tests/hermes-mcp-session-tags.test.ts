import { describe, expect, test } from "bun:test";
import {
	handleHermesReusableTagTool,
	handleHermesSessionTagTool,
} from "../mcp-standalone/hermes-session-tags.mjs";

const extra = {
	_meta: {
		hermes: {
			schemaVersion: 1,
			durableSessionId: "durable-session_123",
			profileId: "work",
			sourcePlatform: "slack",
			isCron: false,
		},
	},
};

describe("production MCP Hermes session tag tools", () => {
	test("builds explicit read, set, add, and remove calls from trusted current-session metadata", async () => {
		const calls: Array<{ path: string; body: unknown }> = [];
		const call = async (path: string, body: unknown) => {
			calls.push({ path, body });
			return {
				content: [
					{ type: "text" as const, text: JSON.stringify({ tags: ["ready"], revision: 1 }) },
				],
			};
		};
		for (const [operation, args] of [
			["read", {}],
			["set", { tags: [" customer report ", "ready"], expected_revision: 4 }],
			["add", { tag: "needs follow-up" }],
			["remove", { tag: "ready" }],
		] as const) {
			const result = await handleHermesSessionTagTool({
				operation,
				args,
				extra,
				connectionId: "connection-a",
				call,
			});
			expect(result.isError).not.toBe(true);
		}

		expect(calls).toEqual([
			{
				path: "/hermes.sessions.tags.read",
				body: { connectionId: "connection-a", metadata: extra._meta.hermes },
			},
			{
				path: "/hermes.sessions.tags.set",
				body: {
					connectionId: "connection-a",
					metadata: extra._meta.hermes,
					tags: [" customer report ", "ready"],
					expectedRevision: 4,
				},
			},
			{
				path: "/hermes.sessions.tags.add",
				body: {
					connectionId: "connection-a",
					metadata: extra._meta.hermes,
					tag: "needs follow-up",
				},
			},
			{
				path: "/hermes.sessions.tags.remove",
				body: { connectionId: "connection-a", metadata: extra._meta.hermes, tag: "ready" },
			},
		]);
		expect(JSON.stringify(calls)).not.toContain("transcript");
		expect(JSON.stringify(calls)).not.toContain("worktreePath");
		expect(JSON.stringify(calls)).not.toContain("token");
	});

	test("fails closed before transport for missing, invalid, or ambiguous session ownership", async () => {
		let transportCalls = 0;
		const call = async () => {
			transportCalls++;
			return { content: [] };
		};
		for (const testCase of [
			{ operation: "read" as const, args: {}, extra: {}, connectionId: "connection-a" },
			{ operation: "read" as const, args: {}, extra, connectionId: null },
			{
				operation: "set" as const,
				args: {
					tags: Array.from({ length: 65 }, (_, index) => `tag-${index}`),
					expected_revision: 0,
				},
				extra,
				connectionId: "connection-a",
			},
			{
				operation: "set" as const,
				args: { tags: ["ready"], expected_revision: -1 },
				extra,
				connectionId: "connection-a",
			},
			{
				operation: "add" as const,
				args: { tag: "x".repeat(101) },
				extra,
				connectionId: "connection-a",
			},
		] as const) {
			const result = await handleHermesSessionTagTool({ ...testCase, call });
			expect(result.isError).toBe(true);
			expect(result.structuredContent).toEqual(
				expect.objectContaining({ ok: false, code: expect.any(String) })
			);
		}
		expect(transportCalls).toBe(0);
	});

	test("registers four explicit bounded production tools without accepting identity arguments", async () => {
		const source = await Bun.file(new URL("../mcp-standalone/server.mjs", import.meta.url)).text();
		for (const name of [
			"read_session_tags",
			"set_session_tags",
			"add_session_tag",
			"remove_session_tag",
		]) {
			expect(source).toContain(`"${name}"`);
		}
		expect(source).toContain("handleHermesSessionTagTool");
		expect(source).toContain("expected_revision: z.number().int().min(0)");
		expect(source).toContain("z.array(z.string().max(100)).max(64)");
		expect(source).not.toContain("manager_id: z.string()");
		expect(source).not.toContain("durable_session_id: z.string()");
	});

	test("builds strict reusable definition and assignment calls without target identity arguments", async () => {
		const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
		const call = async (path: string, body: Record<string, unknown>) => {
			calls.push({ path, body });
			return { content: [] };
		};
		for (const [operation, args] of [
			["list_definitions", { query: "release" }],
			["upsert_definition", { name: "Release", color: "blue" }],
			[
				"update_definition",
				{
					definition_id: "tag-123",
					name: "Ready",
					color: "green",
					expected_revision: 2,
				},
			],
			["delete_definition", { definition_id: "tag-123", expected_revision: 3 }],
			["read_assignments", {}],
			["assign", { definition_id: "tag-123" }],
			["unassign", { definition_id: "tag-123" }],
		] as const) {
			const result = await handleHermesReusableTagTool({
				operation,
				args,
				extra,
				connectionId: "connection-a",
				call,
			});
			expect(result.isError).not.toBe(true);
		}
		expect(calls.map((entry) => entry.path)).toEqual([
			"/hermes.tags.definitions.list",
			"/hermes.tags.definitions.upsert",
			"/hermes.tags.definitions.update",
			"/hermes.tags.definitions.delete",
			"/hermes.sessions.tags.assignments.read",
			"/hermes.sessions.tags.assign",
			"/hermes.sessions.tags.unassign",
		]);
		for (const entry of calls) {
			expect(entry.body).toEqual(
				expect.objectContaining({ connectionId: "connection-a", metadata: extra._meta.hermes })
			);
			expect(entry.body).not.toHaveProperty("managerId");
			expect(entry.body).not.toHaveProperty("durableSessionId");
		}
	});

	test("rejects arbitrary colors, extra keys, oversized values, and invalid revisions before transport", async () => {
		let transportCalls = 0;
		const call = async () => {
			transportCalls++;
			return { content: [] };
		};
		for (const [operation, args] of [
			["upsert_definition", { name: "Unsafe", color: "#fff" }],
			["upsert_definition", { name: "x".repeat(101), color: "blue" }],
			["list_definitions", { query: "x".repeat(101) }],
			["assign", { definition_id: "tag", session_id: "arbitrary" }],
			["delete_definition", { definition_id: "tag", expected_revision: -1 }],
			["update_definition", { definition_id: "tag", expected_revision: 0 }],
		] as const) {
			const result = await handleHermesReusableTagTool({
				operation,
				args,
				extra,
				connectionId: "connection-a",
				call,
			});
			expect(result).toEqual(
				expect.objectContaining({
					isError: true,
					structuredContent: expect.objectContaining({ code: "invalid_arguments" }),
				})
			);
		}
		expect(transportCalls).toBe(0);
	});

	test("registers explicit reusable tools with palette enums and revision bounds", async () => {
		const source = await Bun.file(new URL("../mcp-standalone/server.mjs", import.meta.url)).text();
		for (const name of [
			"list_tag_definitions",
			"upsert_tag_definition",
			"update_tag_definition",
			"delete_tag_definition",
			"read_session_tag_assignments",
			"assign_session_tag",
			"unassign_session_tag",
		]) {
			expect(source).toContain(`"${name}"`);
		}
		const paletteSource = source.match(
			/const HERMES_TAG_COLOR_SCHEMA = z\.enum\(\[([\s\S]*?)\]\);/
		)?.[1];
		expect(paletteSource?.match(/"[^"]+"/g)?.map((color) => JSON.parse(color))).toEqual([
			"gray",
			"blue",
			"cyan",
			"green",
			"amber",
			"orange",
			"red",
			"pink",
			"purple",
		]);
		expect(source).toContain("expected_revision: z.number().int().min(0)");
	});
});
