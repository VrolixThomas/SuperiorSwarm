import "./preload-electron-mock";
import { describe, expect, test } from "bun:test";
import { hermesRuntimeService } from "../src/main/hermes/hermes-runtime-service";
import { t } from "../src/main/trpc";
import {
	hermesCreateInputSchema,
	hermesDeleteSessionInputSchema,
	hermesRouter,
	hermesSetSessionArchivedInputSchema,
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
				hermesSessionId: "session-1",
				archived: true,
			})
		).toEqual({
			connectionId: "connection-1",
			hermesSessionId: "session-1",
			archived: true,
		});
		expect(
			hermesSetSessionArchivedInputSchema.safeParse({
				connectionId: "connection-1",
				hermesSessionId: "session-1",
				archived: true,
				profileId: "renderer-controlled",
				token: "renderer-secret",
			}).success
		).toBe(false);
		expect(
			hermesDeleteSessionInputSchema.safeParse({
				connectionId: "connection-1",
				hermesSessionId: "session-1",
				confirmed: false,
			}).success
		).toBe(false);
		expect(
			hermesDeleteSessionInputSchema.parse({
				connectionId: "connection-1",
				hermesSessionId: "session-1",
				confirmed: true,
			})
		).toEqual({
			connectionId: "connection-1",
			hermesSessionId: "session-1",
			confirmed: true,
		});
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
		const originalArchive = hermesRuntimeService.setSessionArchived;
		const originalDelete = hermesRuntimeService.deleteSession;
		hermesRuntimeService.setSessionArchived = async (...args) => {
			archiveCalls.push(args);
			return catalog;
		};
		hermesRuntimeService.deleteSession = async (...args) => {
			deleteCalls.push(args);
			return catalog;
		};
		try {
			const caller = t.createCallerFactory(hermesRouter)({});
			expect(
				await caller.setSessionArchived({
					connectionId: "connection-main",
					hermesSessionId: "session-main",
					archived: true,
				})
			).toBe(catalog);
			expect(
				await caller.deleteSession({
					connectionId: "connection-main",
					hermesSessionId: "session-main",
					confirmed: true,
				})
			).toBe(catalog);
			expect(archiveCalls).toEqual([["connection-main", "session-main", true]]);
			expect(deleteCalls).toEqual([["connection-main", "session-main", true]]);
		} finally {
			hermesRuntimeService.setSessionArchived = originalArchive;
			hermesRuntimeService.deleteSession = originalDelete;
		}
	});
});
