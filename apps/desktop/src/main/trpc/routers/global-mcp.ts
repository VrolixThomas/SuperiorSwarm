import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { app } from "electron";
import { z } from "zod";
import type { CliPresetName } from "../../../shared/cli-preset";
import { MCP_FORMATS, type McpFormat } from "../../../shared/mcp-format";
import { getDb } from "../../db";
import { customMcpInstall, globalMcpInstall } from "../../db/schema";
import { probeCliInPath } from "../../services/cli-probe";
import {
	cliConfigPaths,
	detectInstalledClis,
	installEntryForCli,
	installEntryToConfig,
	uninstallEntryForCli,
	uninstallEntryFromConfig,
} from "../../services/global-mcp-install";
import { launcherPath } from "../../services/global-mcp-launcher";
import { publicProcedure, router } from "../index";

const cliPresetSchema = z.enum(["claude", "gemini", "codex", "opencode"]);

const mcpFormatSchema = z.enum(MCP_FORMATS);

const ALL_CLIS: CliPresetName[] = ["claude", "gemini", "codex", "opencode"];

export const globalMcpRouter = router({
	listInstalls: publicProcedure.query(async () => {
		const db = getDb();
		const installedRows = db.select().from(globalMcpInstall).all();
		const installedMap = new Map(installedRows.map((r) => [r.cliPreset, r]));
		// Probe all CLIs in parallel — serial probes would stack the per-CLI
		// shell timeout on every settings query.
		const detected = new Set(await detectInstalledClis(probeCliInPath));
		const items = ALL_CLIS.map((cli) => {
			const installed = installedMap.get(cli);
			return {
				cliPreset: cli,
				detected: detected.has(cli),
				installed: !!installed,
				configPath: installed?.configPath ?? cliConfigPaths(cli),
				installedAt: installed?.installedAt ?? null,
			};
		});
		return {
			items,
			launcherPath: launcherPath(app.getPath("userData")),
		};
	}),

	installFor: publicProcedure
		.input(z.object({ cliPreset: cliPresetSchema }))
		.mutation(async ({ input }) => {
			const path = launcherPath(app.getPath("userData"));
			const configPath = installEntryForCli(input.cliPreset, path);
			const db = getDb();
			const now = new Date();
			db.insert(globalMcpInstall)
				.values({ cliPreset: input.cliPreset, configPath, installedAt: now })
				.onConflictDoUpdate({
					target: globalMcpInstall.cliPreset,
					set: { configPath, installedAt: now },
				})
				.run();
			return { configPath };
		}),

	uninstallFor: publicProcedure
		.input(z.object({ cliPreset: cliPresetSchema }))
		.mutation(async ({ input }) => {
			uninstallEntryForCli(input.cliPreset);
			const db = getDb();
			db.delete(globalMcpInstall).where(eq(globalMcpInstall.cliPreset, input.cliPreset)).run();
			return { ok: true };
		}),

	listCustom: publicProcedure.query(async () => {
		const db = getDb();
		return db.select().from(customMcpInstall).all();
	}),

	addCustom: publicProcedure
		.input(
			z.object({
				label: z.string().min(1),
				configPath: z.string().min(1),
				format: mcpFormatSchema,
			})
		)
		.mutation(async ({ input }) => {
			const path = launcherPath(app.getPath("userData"));
			// Throws McpConfigParseError if the target file is invalid; tRPC
			// propagates it to the renderer, which shows it inline. No DB row is
			// written when the merge fails.
			installEntryToConfig(input.configPath, input.format, path);
			const db = getDb();
			const row = {
				id: randomUUID(),
				label: input.label,
				configPath: input.configPath,
				format: input.format,
				installedAt: new Date(),
			};
			db.insert(customMcpInstall).values(row).run();
			return row;
		}),

	removeCustom: publicProcedure.input(z.object({ id: z.string() })).mutation(async ({ input }) => {
		const db = getDb();
		const row = db.select().from(customMcpInstall).where(eq(customMcpInstall.id, input.id)).get();
		if (row) {
			uninstallEntryFromConfig(row.configPath, row.format as McpFormat);
			db.delete(customMcpInstall).where(eq(customMcpInstall.id, input.id)).run();
		}
		return { ok: true };
	}),
});
