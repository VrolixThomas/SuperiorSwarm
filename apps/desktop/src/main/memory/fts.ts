import { getDb } from "../db";

// FTS5 rows are not auto-deleted when a parent project row goes away
// (FTS5 virtual tables cannot be FK targets). Searches scope by project_id
// so orphans are invisible; rely on per-row ftsDelete for cleanup.

export type FtsKind = "goal" | "decision" | "question" | "journal";

export interface FtsUpsertInput {
	kind: FtsKind;
	refId: string;
	projectId: string;
	body: string;
}

export interface FtsDeleteInput {
	kind: FtsKind;
	refId: string;
}

export interface FtsSearchInput {
	projectId: string;
	query: string;
	kinds?: FtsKind[];
	limit?: number;
}

export interface FtsHit {
	kind: FtsKind;
	refId: string;
	projectId: string;
	snippet: string;
	rank: number;
}

export function ftsUpsert(input: FtsUpsertInput): void {
	const sqlite = getDb().$client;
	sqlite
		.prepare("DELETE FROM memory_fts WHERE kind = ? AND ref_id = ?")
		.run(input.kind, input.refId);
	sqlite
		.prepare("INSERT INTO memory_fts (kind, ref_id, project_id, body) VALUES (?, ?, ?, ?)")
		.run(input.kind, input.refId, input.projectId, input.body);
}

export function ftsDelete(input: FtsDeleteInput): void {
	const sqlite = getDb().$client;
	sqlite
		.prepare("DELETE FROM memory_fts WHERE kind = ? AND ref_id = ?")
		.run(input.kind, input.refId);
}

export function ftsSearch(input: FtsSearchInput): FtsHit[] {
	const sqlite = getDb().$client;
	const limit = input.limit ?? 50;
	const kindFilter =
		input.kinds && input.kinds.length > 0
			? `AND kind IN (${input.kinds.map(() => "?").join(",")})`
			: "";
	const stmt = sqlite.prepare(
		`SELECT kind, ref_id AS refId, project_id AS projectId,
		        snippet(memory_fts, 3, '[', ']', '...', 16) AS snippet,
		        bm25(memory_fts) AS rank
		   FROM memory_fts
		  WHERE project_id = ? AND memory_fts MATCH ? ${kindFilter}
		  ORDER BY rank
		  LIMIT ?`
	);
	const params: unknown[] = [input.projectId, input.query];
	if (input.kinds && input.kinds.length > 0) params.push(...input.kinds);
	params.push(limit);
	return stmt.all(...params) as FtsHit[];
}
