import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { desc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { type MemoryJournalEntry, memoryJournal } from "../db/schema-memory";
import { ftsDelete, ftsUpsert } from "./fts";
import { newMemoryId } from "./ids";
import { journalDir, journalFileName } from "./paths";

export interface JournalStartInput {
	userDataPath: string;
	projectId: string;
}

export interface JournalStartResult {
	sessionId: string;
	filePath: string;
	startedAt: Date;
}

export function journalStart(input: JournalStartInput): JournalStartResult {
	const sessionId = newMemoryId("sess");
	const startedAt = new Date();
	const dir = journalDir(input.userDataPath, input.projectId);
	mkdirSync(dir, { recursive: true });

	const fileName = journalFileName(startedAt, sessionId);
	const filePath = `${dir}/${fileName}`;
	writeFileSync(filePath, `# Session ${startedAt.toISOString()} (${sessionId})\n\n`, "utf-8");

	getDb()
		.insert(memoryJournal)
		.values({
			id: sessionId,
			projectId: input.projectId,
			sessionId,
			filePath,
			startedAt,
		})
		.run();

	return { sessionId, filePath, startedAt };
}

export interface JournalAppendInput {
	sessionId: string;
	text: string;
}

export function journalAppend(input: JournalAppendInput): void {
	const row = getDb()
		.select()
		.from(memoryJournal)
		.where(eq(memoryJournal.sessionId, input.sessionId))
		.get();
	if (!row) throw new Error(`journal session not found: ${input.sessionId}`);
	if (row.endedAt) throw new Error(`journal already ended: ${input.sessionId}`);

	const ensureNewline = input.text.endsWith("\n") ? input.text : `${input.text}\n`;
	appendFileSync(row.filePath, ensureNewline, "utf-8");
}

export interface JournalEndInput {
	sessionId: string;
	summary: string;
}

export function journalEnd(input: JournalEndInput): void {
	const db = getDb();
	const row = db
		.select()
		.from(memoryJournal)
		.where(eq(memoryJournal.sessionId, input.sessionId))
		.get();
	if (!row) throw new Error(`journal session not found: ${input.sessionId}`);

	db.update(memoryJournal)
		.set({ endedAt: new Date(), summary: input.summary })
		.where(eq(memoryJournal.sessionId, input.sessionId))
		.run();

	ftsUpsert({
		kind: "journal",
		refId: row.sessionId,
		projectId: row.projectId,
		body: input.summary,
	});
}

export interface RecentJournalsInput {
	projectId: string;
	limit?: number;
}

export function recentJournals(input: RecentJournalsInput): MemoryJournalEntry[] {
	return getDb()
		.select()
		.from(memoryJournal)
		.where(eq(memoryJournal.projectId, input.projectId))
		.orderBy(desc(memoryJournal.startedAt))
		.limit(input.limit ?? 20)
		.all();
}

export interface ReadJournalInput {
	sessionId: string;
}

export function readJournal(input: ReadJournalInput): string {
	const row = getDb()
		.select()
		.from(memoryJournal)
		.where(eq(memoryJournal.sessionId, input.sessionId))
		.get();
	if (!row) throw new Error(`journal session not found: ${input.sessionId}`);
	return readFileSync(row.filePath, "utf-8");
}

export function deleteJournal(sessionId: string): void {
	const db = getDb();
	db.delete(memoryJournal).where(eq(memoryJournal.sessionId, sessionId)).run();
	ftsDelete({ kind: "journal", refId: sessionId });
}
