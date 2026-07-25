import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { appSettings } from "../db/schema";

const TOKEN_KEY = "agentNotifyToken";
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

/**
 * Daemon-owned terminals survive app restarts, so their hook environment must
 * keep working after the main process relaunches. Persist the local bearer
 * token instead of rotating it per process.
 */
export function getOrCreateAgentNotifyToken(): string {
	const db = getDb();
	const existing = db
		.select({ value: appSettings.value })
		.from(appSettings)
		.where(eq(appSettings.key, TOKEN_KEY))
		.get()?.value;
	if (existing && TOKEN_PATTERN.test(existing)) return existing;

	const token = randomBytes(32).toString("hex");
	db.insert(appSettings)
		.values({ key: TOKEN_KEY, value: token })
		.onConflictDoUpdate({
			target: appSettings.key,
			set: { value: token },
		})
		.run();
	return token;
}
