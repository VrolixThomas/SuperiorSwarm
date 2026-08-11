import { and, eq } from "drizzle-orm";
import type { HermesSessionSummary } from "../../shared/hermes";
import { getDb } from "../db";
import { hermesSessionMetadata } from "../db/schema";

export const HERMES_SESSION_TITLE_MAX_LENGTH = 200;
export const HERMES_SESSION_TAG_MAX_LENGTH = 100;
export const HERMES_SESSION_TAG_LIMIT = 64;

export interface HermesSessionMetadataIdentity {
	managerId: string;
	connectionId: string;
	profileId: string;
	durableSessionId: string;
}

export interface HermesSessionMetadataState {
	customTitle: string | null;
	tags: string[];
	revision: number;
	updatedAt: number | null;
}

type MetadataRow = typeof hermesSessionMetadata.$inferSelect;

export class HermesSessionMetadataConflictError extends Error {
	constructor() {
		super("Session metadata changed elsewhere. Refresh and try again.");
		this.name = "HermesSessionMetadataConflictError";
	}
}

function identityWhere(identity: HermesSessionMetadataIdentity) {
	return and(
		eq(hermesSessionMetadata.managerId, identity.managerId),
		eq(hermesSessionMetadata.connectionId, identity.connectionId),
		eq(hermesSessionMetadata.profileId, identity.profileId),
		eq(hermesSessionMetadata.durableSessionId, identity.durableSessionId)
	);
}

function normalizeRequiredText(value: string, label: string, maximumLength: number): string {
	if (value.length > maximumLength) {
		throw new Error(`${label} must be ${maximumLength} characters or fewer`);
	}
	const normalized = value.trim();
	if (!normalized) throw new Error(`${label} cannot be empty`);
	if (Array.from(normalized).some((character) => character.charCodeAt(0) < 32)) {
		throw new Error(`${label} cannot contain control characters`);
	}
	return normalized;
}

export function normalizeHermesSessionTitle(value: string): string {
	return normalizeRequiredText(value, "Session name", HERMES_SESSION_TITLE_MAX_LENGTH);
}

export function normalizeHermesSessionTag(value: string): string {
	return normalizeRequiredText(value, "Tag", HERMES_SESSION_TAG_MAX_LENGTH);
}

export function normalizeHermesSessionTags(values: string[]): string[] {
	if (values.length > HERMES_SESSION_TAG_LIMIT) {
		throw new Error(`Sessions can have at most ${HERMES_SESSION_TAG_LIMIT} tags`);
	}
	const result: string[] = [];
	const seen = new Set<string>();
	for (const value of values) {
		const normalized = normalizeHermesSessionTag(value);
		if (seen.has(normalized)) continue;
		seen.add(normalized);
		result.push(normalized);
	}
	return result;
}

function tagsFromJson(value: string): string[] {
	try {
		const parsed: unknown = JSON.parse(value);
		if (!Array.isArray(parsed) || !parsed.every((tag) => typeof tag === "string")) return [];
		return normalizeHermesSessionTags(parsed);
	} catch {
		return [];
	}
}

function titleFromRow(value: string | null): string | null {
	if (value === null) return null;
	try {
		return normalizeHermesSessionTitle(value);
	} catch {
		return null;
	}
}

function stateFromRow(row: MetadataRow | undefined): HermesSessionMetadataState {
	if (!row) return { customTitle: null, tags: [], revision: 0, updatedAt: null };
	return {
		customTitle: titleFromRow(row.customTitle),
		tags: tagsFromJson(row.tagsJson),
		revision: row.revision,
		updatedAt: row.updatedAt.getTime(),
	};
}

function selectRow(
	db: Pick<ReturnType<typeof getDb>, "select">,
	identity: HermesSessionMetadataIdentity
): MetadataRow | undefined {
	return db.select().from(hermesSessionMetadata).where(identityWhere(identity)).get() as
		| MetadataRow
		| undefined;
}

export function getHermesSessionMetadata(
	identity: HermesSessionMetadataIdentity
): HermesSessionMetadataState {
	return stateFromRow(selectRow(getDb(), identity));
}

type MetadataWriteStore = Pick<ReturnType<typeof getDb>, "insert" | "select" | "update">;

function replaceMetadataInTransaction(
	db: MetadataWriteStore,
	input: {
		identity: HermesSessionMetadataIdentity;
		expectedRevision: number;
		customTitle?: string;
		tags?: string[];
	}
): HermesSessionMetadataState {
	if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) {
		throw new Error("Session metadata revision is invalid");
	}
	const row = selectRow(db, input.identity);
	const current = stateFromRow(row);
	if (current.revision !== input.expectedRevision) {
		throw new HermesSessionMetadataConflictError();
	}
	const customTitle = input.customTitle ?? current.customTitle;
	const tags = input.tags ?? current.tags;
	if (
		customTitle === current.customTitle &&
		tags.length === current.tags.length &&
		tags.every((tag, index) => tag === current.tags[index])
	) {
		return current;
	}
	const now = new Date();
	const revision = current.revision + 1;
	if (!row) {
		db.insert(hermesSessionMetadata)
			.values({
				...input.identity,
				customTitle,
				tagsJson: JSON.stringify(tags),
				revision,
				createdAt: now,
				updatedAt: now,
			})
			.run();
	} else {
		const updated = db
			.update(hermesSessionMetadata)
			.set({ customTitle, tagsJson: JSON.stringify(tags), revision, updatedAt: now })
			.where(
				and(identityWhere(input.identity), eq(hermesSessionMetadata.revision, current.revision))
			)
			.run();
		if (updated.changes !== 1) throw new HermesSessionMetadataConflictError();
	}
	return { customTitle, tags, revision, updatedAt: now.getTime() };
}

function replaceMetadata(input: {
	identity: HermesSessionMetadataIdentity;
	expectedRevision: number;
	customTitle?: string;
	tags?: string[];
}): HermesSessionMetadataState {
	return getDb().transaction((tx) => replaceMetadataInTransaction(tx, input));
}

export function setHermesSessionTitle(
	input: HermesSessionMetadataIdentity & { title: string; expectedRevision: number }
): HermesSessionMetadataState {
	const { title, expectedRevision, ...identity } = input;
	return replaceMetadata({
		identity,
		expectedRevision,
		customTitle: normalizeHermesSessionTitle(title),
	});
}

export function setHermesSessionTags(
	input: HermesSessionMetadataIdentity & { tags: string[]; expectedRevision: number }
): HermesSessionMetadataState {
	const { tags, expectedRevision, ...identity } = input;
	return replaceMetadata({
		identity,
		expectedRevision,
		tags: normalizeHermesSessionTags(tags),
	});
}

export function addHermesSessionTag(
	input: HermesSessionMetadataIdentity & { tag: string }
): HermesSessionMetadataState {
	const { tag, ...identity } = input;
	const normalized = normalizeHermesSessionTag(tag);
	return getDb().transaction((tx) => {
		const current = stateFromRow(selectRow(tx, identity));
		if (current.tags.includes(normalized)) return current;
		if (current.tags.length >= HERMES_SESSION_TAG_LIMIT) {
			throw new Error(`Sessions can have at most ${HERMES_SESSION_TAG_LIMIT} tags`);
		}
		return replaceMetadataInTransaction(tx, {
			identity,
			expectedRevision: current.revision,
			tags: [...current.tags, normalized],
		});
	});
}

export function removeHermesSessionTag(
	input: HermesSessionMetadataIdentity & { tag: string }
): HermesSessionMetadataState {
	const { tag, ...identity } = input;
	const normalized = normalizeHermesSessionTag(tag);
	return getDb().transaction((tx) => {
		const current = stateFromRow(selectRow(tx, identity));
		if (!current.tags.includes(normalized)) return current;
		return replaceMetadataInTransaction(tx, {
			identity,
			expectedRevision: current.revision,
			tags: current.tags.filter((candidate) => candidate !== normalized),
		});
	});
}

export function deleteHermesSessionMetadata(identity: HermesSessionMetadataIdentity): void {
	getDb().delete(hermesSessionMetadata).where(identityWhere(identity)).run();
}

export function applyHermesSessionMetadata(
	identity: HermesSessionMetadataIdentity,
	session: HermesSessionSummary
): HermesSessionSummary {
	const metadata = getHermesSessionMetadata(identity);
	const generatedTitle = session.generatedTitle || session.title;
	return {
		...session,
		title: metadata.customTitle ?? generatedTitle,
		generatedTitle,
		titleSource: metadata.customTitle === null ? "generated" : "custom",
		tags: metadata.tags,
		metadataRevision: metadata.revision,
	};
}
