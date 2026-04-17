import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { lspDismissedLanguages } from "../db/schema";

export function dismissLanguage(language: string): void {
	const db = getDb();
	db.insert(lspDismissedLanguages)
		.values({ language, dismissedAt: new Date() })
		.onConflictDoNothing()
		.run();
}

export function undismissLanguage(language: string): void {
	const db = getDb();
	db.delete(lspDismissedLanguages).where(eq(lspDismissedLanguages.language, language)).run();
}

export function getDismissedLanguages(): string[] {
	const db = getDb();
	return db
		.select({ language: lspDismissedLanguages.language })
		.from(lspDismissedLanguages)
		.all()
		.map((row) => row.language);
}
