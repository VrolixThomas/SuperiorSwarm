import { eq } from "drizzle-orm";
import { BrowserWindow } from "electron";
import { z } from "zod";
import type { ThemePref } from "../../../shared/types";
import { getDb } from "../../db";
import { appSettings } from "../../db/schema";
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

export const settingsRouter = router({
	getTheme: publicProcedure.query(() => readTheme()),
	setTheme: publicProcedure.input(themeSchema).mutation(({ input }) => {
		writeTheme(input);
		broadcastTheme(input);
		return input;
	}),
});
