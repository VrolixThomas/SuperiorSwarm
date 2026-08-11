import { describe, expect, test } from "bun:test";
import {
	hermesDeleteTagDefinitionInputSchema,
	hermesListTagDefinitionsInputSchema,
	hermesTagAssignmentInputSchema,
	hermesUpdateTagDefinitionInputSchema,
	hermesUpsertTagDefinitionInputSchema,
} from "../src/main/trpc/routers/hermes";

const identity = {
	connectionId: "connection-a",
	profileId: "work",
	hermesSessionId: "session-a",
};

describe("Hermes reusable tag renderer schemas", () => {
	test("accepts bounded palette and optimistic definition operations", () => {
		expect(hermesListTagDefinitionsInputSchema.parse({ ...identity, query: "release" })).toEqual({
			...identity,
			query: "release",
		});
		expect(
			hermesUpsertTagDefinitionInputSchema.parse({ ...identity, name: "Ready", color: "green" })
		).toEqual({ ...identity, name: "Ready", color: "green" });
		expect(
			hermesUpdateTagDefinitionInputSchema.parse({
				...identity,
				definitionId: "tag-123",
				color: "amber",
				expectedRevision: 2,
			})
		).toEqual({ ...identity, definitionId: "tag-123", color: "amber", expectedRevision: 2 });
		expect(
			hermesDeleteTagDefinitionInputSchema.parse({
				...identity,
				definitionId: "tag-123",
				expectedRevision: 3,
			})
		).toEqual({ ...identity, definitionId: "tag-123", expectedRevision: 3 });
		expect(hermesTagAssignmentInputSchema.parse({ ...identity, definitionId: "tag-123" })).toEqual({
			...identity,
			definitionId: "tag-123",
		});
	});

	test("rejects extra targeting keys, raw colors, missing updates, and oversized input", () => {
		for (const [schema, value] of [
			[
				hermesListTagDefinitionsInputSchema,
				{ ...identity, query: "", durableSessionId: "arbitrary" },
			],
			[hermesUpsertTagDefinitionInputSchema, { ...identity, name: "Ready", color: "#fff" }],
			[
				hermesUpdateTagDefinitionInputSchema,
				{ ...identity, definitionId: "tag-123", expectedRevision: 0 },
			],
			[hermesUpsertTagDefinitionInputSchema, { ...identity, name: "x".repeat(101), color: "blue" }],
			[
				hermesDeleteTagDefinitionInputSchema,
				{ ...identity, definitionId: "tag-123", expectedRevision: -1 },
			],
		] as const) {
			expect(schema.safeParse(value).success).toBe(false);
		}
	});
});
