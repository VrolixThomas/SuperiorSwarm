import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	handleHermesSessionHandover,
	parseHermesSessionMetadata,
	withAutomaticHermesSessionAdmission,
} from "../mcp-standalone/hermes-session-admission.mjs";

const validExtra = {
	_meta: {
		hermes: {
			schemaVersion: 1,
			durableSessionId: "durable-session_123",
			profileId: "work-profile",
			sourcePlatform: "slack",
			isCron: false,
		},
	},
} as const;

describe("Hermes MCP session admission", () => {
	test("validates the exact bounded metadata envelope and rejects missing or hostile values", () => {
		expect(parseHermesSessionMetadata(validExtra)).toEqual({
			ok: true,
			metadata: validExtra._meta.hermes,
		});
		expect(parseHermesSessionMetadata({})).toMatchObject({
			ok: false,
			code: "missing_metadata",
		});
		for (const hermes of [
			{ ...validExtra._meta.hermes, schemaVersion: 2 },
			{ ...validExtra._meta.hermes, durableSessionId: "../escape" },
			{ ...validExtra._meta.hermes, durableSessionId: "x".repeat(513) },
			{ ...validExtra._meta.hermes, profileId: "profile with spaces" },
			{ ...validExtra._meta.hermes, sourcePlatform: "javascript:alert(1)" },
			{ ...validExtra._meta.hermes, isCron: "false" },
			{ ...validExtra._meta.hermes, managerId: "attacker-chosen-manager" },
		]) {
			expect(parseHermesSessionMetadata({ _meta: { hermes } })).toMatchObject({
				ok: false,
				code: "invalid_metadata",
			});
		}
	});

	test("admits valid metadata around an existing tool but preserves tool behavior when absent/invalid", async () => {
		const admissions: Array<{ reason: string; durableSessionId: string }> = [];
		const calls: string[] = [];
		const wrapped = withAutomaticHermesSessionAdmission(
			async ({ value }: { value: string }) => {
				calls.push(value);
				return { content: [{ type: "text", text: value }] };
			},
			async (metadata, reason) => {
				admissions.push({ reason, durableSessionId: metadata.durableSessionId });
				return { admitted: true, reason };
			}
		);

		expect(await wrapped({ value: "valid" }, validExtra)).toMatchObject({
			content: [{ text: "valid" }],
		});
		expect(await wrapped({ value: "missing" }, {})).toMatchObject({
			content: [{ text: "missing" }],
		});
		expect(
			await wrapped(
				{ value: "invalid" },
				{ _meta: { hermes: { ...validExtra._meta.hermes, isCron: "no" } } }
			)
		).toMatchObject({ content: [{ text: "invalid" }] });
		expect(calls).toEqual(["valid", "missing", "invalid"]);
		expect(admissions).toEqual([{ reason: "mcp", durableSessionId: "durable-session_123" }]);
	});

	test("explicit handover returns clear structured success and metadata errors", async () => {
		const admitted = await handleHermesSessionHandover(validExtra, async (metadata, reason) => ({
			admitted: true,
			reason,
			durableSessionId: metadata.durableSessionId,
			profileId: metadata.profileId,
		}));
		expect(admitted).toMatchObject({
			isError: false,
			structuredContent: {
				admitted: true,
				reason: "handover",
				durableSessionId: "durable-session_123",
				profileId: "work-profile",
			},
		});

		for (const extra of [{}, { _meta: { hermes: { isCron: false } } }]) {
			const rejected = await handleHermesSessionHandover(extra, async () => ({ admitted: true }));
			expect(rejected).toMatchObject({
				isError: true,
				structuredContent: { admitted: false },
			});
			expect(JSON.parse(rejected.content[0]?.text ?? "{}").message).toContain(
				"Hermes session metadata"
			);
		}
	});

	test("centrally wraps every coordination tool registered for external managers", () => {
		const source = readFileSync(join(import.meta.dir, "../mcp-standalone/server.mjs"), "utf8");
		const coordinationBlock = source.slice(source.indexOf("if (isWorkspaceAgentOrCrossRepo)"));
		const override = coordinationBlock.indexOf("server.tool =");
		const firstRegistration = coordinationBlock.indexOf("server.tool(", override);
		expect(override).toBeGreaterThanOrEqual(0);
		expect(coordinationBlock.slice(override, firstRegistration)).toContain(
			"withAutomaticHermesSessionAdmission"
		);
		expect(coordinationBlock).toContain('"handover_session"');
	});
});
