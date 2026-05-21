import { eq } from "drizzle-orm";
import { app } from "electron";
import { z } from "zod";
import type { CliPresetName } from "../../../shared/cli-preset";
import { getDb } from "../../db";
import { globalMcpInstall } from "../../db/schema";
import { probeCliInPath } from "../../services/cli-probe";
import {
	cliConfigPaths,
	installEntryForCli,
	uninstallEntryForCli,
} from "../../services/global-mcp-install";
import { launcherPath } from "../../services/global-mcp-launcher";
import { publicProcedure, router } from "../index";

const cliPresetSchema = z.enum(["claude", "gemini", "codex", "opencode"]);

const ALL_CLIS: CliPresetName[] = ["claude", "gemini", "codex", "opencode"];

export const globalMcpRouter = router({
	listInstalls: publicProcedure.query(async () => {
		const db = getDb();
		const installedRows = db.select().from(globalMcpInstall).all();
		const installedMap = new Map(installedRows.map((r) => [r.cliPreset, r]));
		const out = [];
		for (const cli of ALL_CLIS) {
			const detected = await probeCliInPath(cli);
			const installed = installedMap.get(cli);
			out.push({
				cliPreset: cli,
				detected,
				installed: !!installed,
				configPath: installed?.configPath ?? cliConfigPaths(cli),
				installedAt: installed?.installedAt ?? null,
			});
		}
		return {
			items: out,
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
});
