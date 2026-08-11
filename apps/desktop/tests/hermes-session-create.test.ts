import "./preload-electron-mock";
import { describe, expect, test } from "bun:test";
import { hermesRuntimeService } from "../src/main/hermes/hermes-runtime-service";
import { t } from "../src/main/trpc";
import {
	hermesCreateInputSchema,
	hermesDeleteSessionInputSchema,
	hermesRouter,
	hermesSessionTagInputSchema,
	hermesSetSessionArchivedInputSchema,
	hermesSetSessionTagsInputSchema,
	hermesSetSessionTitleInputSchema,
} from "../src/main/trpc/routers/hermes";
import type { HermesCatalog } from "../src/shared/hermes";

describe("Hermes task session creation contract", () => {
	test("accepts task and connection infrastructure but rejects a preselected cwd", () => {
		expect(
			hermesCreateInputSchema.parse({
				connectionId: "connection-1",
				topic: "Investigate the release failure across relevant repositories",
				profileId: "work",
			})
		).toEqual({
			connectionId: "connection-1",
			topic: "Investigate the release failure across relevant repositories",
			profileId: "work",
		});
		for (const forbidden of [
			{ cwd: "/repos/preselected-worktree" },
			{ workspaceId: "workspace-preselected" },
		]) {
			expect(
				hermesCreateInputSchema.safeParse({
					connectionId: "connection-1",
					topic: "Investigate the release failure",
					profileId: "work",
					...forbidden,
				}).success
			).toBe(false);
		}
	});

	test("keeps session mutations credential-free and requires an explicit deletion confirmation", () => {
		expect(
			hermesSetSessionArchivedInputSchema.parse({
				connectionId: "connection-1",
				profileId: "work",
				hermesSessionId: "session-1",
				archived: true,
			})
		).toEqual({
			connectionId: "connection-1",
			profileId: "work",
			hermesSessionId: "session-1",
			archived: true,
		});
		expect(
			hermesSetSessionArchivedInputSchema.safeParse({
				connectionId: "connection-1",
				hermesSessionId: "session-1",
				archived: true,
				token: "renderer-secret",
			}).success
		).toBe(false);
		expect(
			hermesSetSessionArchivedInputSchema.safeParse({
				connectionId: "connection-1",
				hermesSessionId: "session-1",
				archived: true,
			}).success
		).toBe(false);
		expect(
			hermesDeleteSessionInputSchema.safeParse({
				connectionId: "connection-1",
				profileId: "work",
				hermesSessionId: "session-1",
				confirmed: false,
			}).success
		).toBe(false);
		expect(
			hermesDeleteSessionInputSchema.parse({
				connectionId: "connection-1",
				profileId: "work",
				hermesSessionId: "session-1",
				confirmed: true,
			})
		).toEqual({
			connectionId: "connection-1",
			profileId: "work",
			hermesSessionId: "session-1",
			confirmed: true,
		});
	});

	test("validates explicit rename and tag DTOs without renderer-supplied ownership or secrets", () => {
		const identity = {
			connectionId: "connection-1",
			profileId: "work",
			hermesSessionId: "session-1",
		};
		expect(
			hermesSetSessionTitleInputSchema.parse({
				...identity,
				title: "  Release readiness  ",
				expectedRevision: 3,
			})
		).toEqual({ ...identity, title: "  Release readiness  ", expectedRevision: 3 });
		expect(
			hermesSetSessionTagsInputSchema.parse({
				...identity,
				tags: ["customer report", " urgent "],
				expectedRevision: 3,
			})
		).toEqual({ ...identity, tags: ["customer report", " urgent "], expectedRevision: 3 });
		expect(hermesSessionTagInputSchema.parse({ ...identity, tag: " needs follow-up " })).toEqual({
			...identity,
			tag: " needs follow-up ",
		});

		for (const invalid of [
			{ ...identity, title: "x", expectedRevision: -1 },
			{ ...identity, title: "x", expectedRevision: 0, managerId: "spoofed" },
			{ ...identity, title: "x", expectedRevision: 0, token: "renderer-secret" },
			{ ...identity, title: "x", expectedRevision: 0, transcript: "private" },
			{ ...identity, title: "x", expectedRevision: 0, worktreePath: "/private/repo" },
		]) {
			expect(hermesSetSessionTitleInputSchema.safeParse(invalid).success).toBe(false);
		}
		expect(
			hermesSetSessionTagsInputSchema.safeParse({
				...identity,
				tags: Array.from({ length: 65 }, (_, index) => `tag-${index}`),
				expectedRevision: 0,
			}).success
		).toBe(false);
		expect(
			hermesSessionTagInputSchema.safeParse({ ...identity, tag: "x".repeat(101) }).success
		).toBe(false);
	});

	test("routes exact metadata mutations through the connected main runtime service", async () => {
		const calls: Array<{ operation: string; args: unknown[] }> = [];
		const result = {
			customTitle: "Release",
			tags: [
				{
					id: "tag-ready",
					name: "ready",
					normalizedKey: "ready",
					color: "green" as const,
					revision: 0,
					createdAt: 1,
					updatedAt: 1,
				},
			],
			revision: 4,
			updatedAt: 1,
		};
		const originals = {
			setSessionTitle: hermesRuntimeService.setSessionTitle,
			setSessionTags: hermesRuntimeService.setSessionTags,
			addSessionTag: hermesRuntimeService.addSessionTag,
			removeSessionTag: hermesRuntimeService.removeSessionTag,
		};
		hermesRuntimeService.setSessionTitle = async (...args) => {
			calls.push({ operation: "title", args });
			return result;
		};
		hermesRuntimeService.setSessionTags = async (...args) => {
			calls.push({ operation: "set", args });
			return result;
		};
		hermesRuntimeService.addSessionTag = async (...args) => {
			calls.push({ operation: "add", args });
			return result;
		};
		hermesRuntimeService.removeSessionTag = async (...args) => {
			calls.push({ operation: "remove", args });
			return result;
		};
		try {
			const caller = t.createCallerFactory(hermesRouter)({});
			await caller.setSessionTitle({
				connectionId: "connection-main",
				profileId: "work",
				hermesSessionId: "session-main",
				title: "Release",
				expectedRevision: 2,
			});
			await caller.setSessionTags({
				connectionId: "connection-main",
				profileId: "work",
				hermesSessionId: "session-main",
				tags: ["ready"],
				expectedRevision: 3,
			});
			await caller.addSessionTag({
				connectionId: "connection-main",
				profileId: "work",
				hermesSessionId: "session-main",
				tag: "ready",
			});
			await caller.removeSessionTag({
				connectionId: "connection-main",
				profileId: "work",
				hermesSessionId: "session-main",
				tag: "ready",
			});
			expect(calls).toEqual([
				{
					operation: "title",
					args: ["connection-main", "work", "session-main", "Release", 2],
				},
				{
					operation: "set",
					args: ["connection-main", "work", "session-main", ["ready"], 3],
				},
				{
					operation: "add",
					args: ["connection-main", "work", "session-main", "ready"],
				},
				{
					operation: "remove",
					args: ["connection-main", "work", "session-main", "ready"],
				},
			]);
		} finally {
			hermesRuntimeService.setSessionTitle = originals.setSessionTitle;
			hermesRuntimeService.setSessionTags = originals.setSessionTags;
			hermesRuntimeService.addSessionTag = originals.addSessionTag;
			hermesRuntimeService.removeSessionTag = originals.removeSessionTag;
		}
	});

	test("routes renderer-safe archive and deletion mutations only through the main runtime service", async () => {
		const catalog: HermesCatalog = {
			compatibility: {
				state: "compatible",
				authMode: "token",
				canBrowse: true,
				canChat: true,
				canReport: false,
				limitations: [],
			},
			sessions: [],
		};
		const archiveCalls: unknown[][] = [];
		const deleteCalls: unknown[][] = [];
		const deletionResult = { committed: true as const, catalog, reconciliationRequired: false };
		const originalArchive = hermesRuntimeService.setSessionArchived;
		const originalDelete = hermesRuntimeService.deleteSession;
		hermesRuntimeService.setSessionArchived = async (...args) => {
			archiveCalls.push(args);
			return catalog;
		};
		hermesRuntimeService.deleteSession = async (...args) => {
			deleteCalls.push(args);
			return deletionResult;
		};
		try {
			const caller = t.createCallerFactory(hermesRouter)({});
			expect(
				await caller.setSessionArchived({
					connectionId: "connection-main",
					profileId: "work",
					hermesSessionId: "session-main",
					archived: true,
				})
			).toBe(catalog);
			expect(
				await caller.deleteSession({
					connectionId: "connection-main",
					profileId: "work",
					hermesSessionId: "session-main",
					confirmed: true,
				})
			).toBe(deletionResult);
			expect(archiveCalls).toEqual([["connection-main", "work", "session-main", true]]);
			expect(deleteCalls).toEqual([["connection-main", "work", "session-main", true]]);
		} finally {
			hermesRuntimeService.setSessionArchived = originalArchive;
			hermesRuntimeService.deleteSession = originalDelete;
		}
	});
});
