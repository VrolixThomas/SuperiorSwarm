import { eq } from "drizzle-orm";
import { BrowserWindow } from "electron";
import { z } from "zod";
import type { ThemePref } from "../../../shared/types";
import { getDb } from "../../db";
import { appSettings, sessionState } from "../../db/schema";
import { publicProcedure, router } from "../index";

const themeSchema = z.enum(["system", "light", "dark"]);

const THEME_KEY = "theme";
const DEFAULT_THEME: ThemePref = "system";

function readTheme(): ThemePref {
	const db = getDb();
	const row = db.select().from(appSettings).where(eq(appSettings.key, THEME_KEY)).get();
	const parsed = themeSchema.safeParse(row?.value);
	return parsed.success ? parsed.data : DEFAULT_THEME;
}

function writeTheme(value: ThemePref): void {
	const db = getDb();
	db.insert(appSettings)
		.values({ key: THEME_KEY, value })
		.onConflictDoUpdate({ target: appSettings.key, set: { value } })
		.run();
}

function broadcastTheme(value: ThemePref): void {
	for (const win of BrowserWindow.getAllWindows()) {
		if (!win.isDestroyed()) {
			win.webContents.send("settings:theme-changed", value);
		}
	}
}

const XRO_COLOR_KEY = "xro_color_map";

export const settingsRouter = router({
	getTheme: publicProcedure.query(() => readTheme()),
	setTheme: publicProcedure.input(themeSchema).mutation(({ input }) => {
		writeTheme(input);
		broadcastTheme(input);
		return input;
	}),

	getCrossRepoOrchestratorColors: publicProcedure.query(() => {
		const db = getDb();
		const row = db.select().from(sessionState).where(eq(sessionState.key, XRO_COLOR_KEY)).get();
		return row ? (JSON.parse(row.value) as Record<string, number>) : {};
	}),

	setCrossRepoOrchestratorColors: publicProcedure
		.input(z.object({ map: z.record(z.string(), z.number().int().min(0).max(7)) }))
		.mutation(({ input }) => {
			const db = getDb();
			const value = JSON.stringify(input.map);
			db.insert(sessionState)
				.values({ key: XRO_COLOR_KEY, value })
				.onConflictDoUpdate({ target: sessionState.key, set: { value } })
				.run();
			return { ok: true } as const;
		}),
});
