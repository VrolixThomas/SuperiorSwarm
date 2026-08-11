import { and, asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
	HERMES_TAG_COLORS,
	type HermesSessionSummary,
	type HermesTagColor,
	type HermesTagDefinition,
} from "../../shared/hermes";
import { getDb } from "../db";
import {
	hermesSessionMetadata,
	hermesSessionTagAssignments,
	hermesTagDefinitions,
} from "../db/schema";

export { HERMES_TAG_COLORS } from "../../shared/hermes";
export const HERMES_SESSION_TITLE_MAX_LENGTH = 200;
export const HERMES_SESSION_TAG_MAX_LENGTH = 100;
export const HERMES_SESSION_TAG_LIMIT = 64;

export interface HermesTagScope {
	managerId: string;
	connectionId: string;
	profileId: string;
}

export interface HermesSessionMetadataIdentity extends HermesTagScope {
	durableSessionId: string;
}

export interface HermesSessionMetadataState {
	customTitle: string | null;
	tags: HermesTagDefinition[];
	revision: number;
	updatedAt: number | null;
}

type DatabaseStore = Pick<ReturnType<typeof getDb>, "delete" | "insert" | "select" | "update">;
type MetadataRow = typeof hermesSessionMetadata.$inferSelect;
type DefinitionRow = typeof hermesTagDefinitions.$inferSelect;

export class HermesSessionMetadataConflictError extends Error {
	constructor() {
		super("Session metadata changed elsewhere. Refresh and try again.");
		this.name = "HermesSessionMetadataConflictError";
	}
}

export class HermesTagConflictError extends Error {
	constructor(
		message = "A tag with that name already exists in this scope.",
		readonly code: "tag_name_conflict" | "revision_conflict" = "tag_name_conflict"
	) {
		super(message);
		this.name = "HermesTagConflictError";
	}
}

export class HermesTagNotFoundError extends Error {
	constructor() {
		super("Tag definition was not found");
		this.name = "HermesTagNotFoundError";
	}
}

function scopeWhere(scope: HermesTagScope) {
	return and(
		eq(hermesTagDefinitions.managerId, scope.managerId),
		eq(hermesTagDefinitions.connectionId, scope.connectionId),
		eq(hermesTagDefinitions.profileId, scope.profileId)
	);
}

function definitionWhere(scope: HermesTagScope, definitionId: string) {
	return and(scopeWhere(scope), eq(hermesTagDefinitions.id, definitionId));
}

function identityWhere(identity: HermesSessionMetadataIdentity) {
	return and(
		eq(hermesSessionMetadata.managerId, identity.managerId),
		eq(hermesSessionMetadata.connectionId, identity.connectionId),
		eq(hermesSessionMetadata.profileId, identity.profileId),
		eq(hermesSessionMetadata.durableSessionId, identity.durableSessionId)
	);
}

function assignmentIdentityWhere(identity: HermesSessionMetadataIdentity) {
	return and(
		eq(hermesSessionTagAssignments.managerId, identity.managerId),
		eq(hermesSessionTagAssignments.connectionId, identity.connectionId),
		eq(hermesSessionTagAssignments.profileId, identity.profileId),
		eq(hermesSessionTagAssignments.durableSessionId, identity.durableSessionId)
	);
}

function normalizeRequiredText(value: string, label: string, maximumLength: number): string {
	if (value.length > maximumLength) {
		throw new Error(`${label} must be ${maximumLength} characters or fewer`);
	}
	const normalized = value.normalize("NFKC").trim();
	if (normalized.length > maximumLength) {
		throw new Error(`${label} must be ${maximumLength} characters or fewer`);
	}
	if (!normalized) throw new Error(`${label} cannot be empty`);
	if (
		Array.from(normalized).some((character) => {
			const codePoint = character.codePointAt(0) ?? 0;
			return codePoint < 32 || codePoint === 127;
		})
	) {
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

export function normalizeHermesTagKey(value: string): string {
	return normalizeHermesSessionTag(value).toLocaleLowerCase("en-US");
}

function normalizeLegacyTagNames(values: string[]): string[] {
	if (values.length > HERMES_SESSION_TAG_LIMIT) {
		throw new Error(`Sessions can have at most ${HERMES_SESSION_TAG_LIMIT} tags`);
	}
	const result: string[] = [];
	const seen = new Set<string>();
	for (const value of values) {
		const name = normalizeHermesSessionTag(value);
		const key = normalizeHermesTagKey(name);
		if (seen.has(key)) continue;
		seen.add(key);
		result.push(name);
	}
	return result;
}

export function normalizeHermesSessionTags(values: string[]): string[] {
	return normalizeLegacyTagNames(values);
}

function assertColor(value: string): asserts value is HermesTagColor {
	if (!(HERMES_TAG_COLORS as readonly string[]).includes(value)) {
		throw new Error("Tag color is invalid");
	}
}

function definitionFromRow(row: DefinitionRow): HermesTagDefinition {
	return {
		id: row.id,
		name: row.name,
		normalizedKey: row.normalizedKey,
		color: row.color,
		revision: row.revision,
		createdAt: row.createdAt.getTime(),
		updatedAt: row.updatedAt.getTime(),
	};
}

function selectMetadataRow(
	db: Pick<ReturnType<typeof getDb>, "select">,
	identity: HermesSessionMetadataIdentity
): MetadataRow | undefined {
	return db.select().from(hermesSessionMetadata).where(identityWhere(identity)).get() as
		| MetadataRow
		| undefined;
}

function selectDefinition(
	db: Pick<ReturnType<typeof getDb>, "select">,
	scope: HermesTagScope,
	definitionId: string
): DefinitionRow | undefined {
	return db.select().from(hermesTagDefinitions).where(definitionWhere(scope, definitionId)).get() as
		| DefinitionRow
		| undefined;
}

function selectDefinitionByKey(
	db: Pick<ReturnType<typeof getDb>, "select">,
	scope: HermesTagScope,
	normalizedKey: string
): DefinitionRow | undefined {
	return db
		.select()
		.from(hermesTagDefinitions)
		.where(and(scopeWhere(scope), eq(hermesTagDefinitions.normalizedKey, normalizedKey)))
		.get() as DefinitionRow | undefined;
}

function titleFromRow(value: string | null): string | null {
	if (value === null) return null;
	try {
		return normalizeHermesSessionTitle(value);
	} catch {
		return null;
	}
}

function assignedDefinitions(
	db: Pick<ReturnType<typeof getDb>, "select">,
	identity: HermesSessionMetadataIdentity
): HermesTagDefinition[] {
	return db
		.select({ definition: hermesTagDefinitions })
		.from(hermesSessionTagAssignments)
		.innerJoin(
			hermesTagDefinitions,
			and(
				eq(hermesSessionTagAssignments.definitionId, hermesTagDefinitions.id),
				eq(hermesSessionTagAssignments.managerId, hermesTagDefinitions.managerId),
				eq(hermesSessionTagAssignments.connectionId, hermesTagDefinitions.connectionId),
				eq(hermesSessionTagAssignments.profileId, hermesTagDefinitions.profileId)
			)
		)
		.where(assignmentIdentityWhere(identity))
		.orderBy(asc(hermesSessionTagAssignments.position))
		.all()
		.map((row) => definitionFromRow(row.definition));
}

function stateFromStore(
	db: Pick<ReturnType<typeof getDb>, "select">,
	identity: HermesSessionMetadataIdentity
): HermesSessionMetadataState {
	const row = selectMetadataRow(db, identity);
	return {
		customTitle: titleFromRow(row?.customTitle ?? null),
		tags: assignedDefinitions(db, identity),
		revision: row?.revision ?? 0,
		updatedAt: row?.updatedAt.getTime() ?? null,
	};
}

function syncLegacyTagsJson(db: DatabaseStore, identity: HermesSessionMetadataIdentity): void {
	if (!selectMetadataRow(db, identity)) return;
	db.update(hermesSessionMetadata)
		.set({
			legacyTagsJson: JSON.stringify(
				assignedDefinitions(db, identity).map((definition) => definition.name)
			),
		})
		.where(identityWhere(identity))
		.run();
}

export function getHermesSessionMetadata(
	identity: HermesSessionMetadataIdentity
): HermesSessionMetadataState {
	return stateFromStore(getDb(), identity);
}

function replaceMetadataRow(
	db: DatabaseStore,
	identity: HermesSessionMetadataIdentity,
	current: MetadataRow | undefined,
	values: { customTitle: string | null; revision: number; now: Date }
): void {
	if (!current) {
		db.insert(hermesSessionMetadata)
			.values({
				...identity,
				customTitle: values.customTitle,
				legacyTagsJson: "[]",
				revision: values.revision,
				createdAt: values.now,
				updatedAt: values.now,
			})
			.run();
		return;
	}
	const updated = db
		.update(hermesSessionMetadata)
		.set({
			customTitle: values.customTitle,
			revision: values.revision,
			updatedAt: values.now,
		})
		.where(and(identityWhere(identity), eq(hermesSessionMetadata.revision, current.revision)))
		.run();
	if (updated.changes !== 1) throw new HermesSessionMetadataConflictError();
}

export function setHermesSessionTitle(
	input: HermesSessionMetadataIdentity & { title: string; expectedRevision: number }
): HermesSessionMetadataState {
	const { title, expectedRevision, ...identity } = input;
	const customTitle = normalizeHermesSessionTitle(title);
	return getDb().transaction((tx) => {
		const row = selectMetadataRow(tx, identity);
		if ((row?.revision ?? 0) !== expectedRevision) throw new HermesSessionMetadataConflictError();
		if (titleFromRow(row?.customTitle ?? null) === customTitle) return stateFromStore(tx, identity);
		replaceMetadataRow(tx, identity, row, {
			customTitle,
			revision: expectedRevision + 1,
			now: new Date(),
		});
		return stateFromStore(tx, identity);
	});
}

export function listHermesTagDefinitions(scope: HermesTagScope, query = ""): HermesTagDefinition[] {
	const normalizedQuery = query.trim().normalize("NFKC").toLocaleLowerCase("en-US");
	return getDb()
		.select()
		.from(hermesTagDefinitions)
		.where(scopeWhere(scope))
		.orderBy(asc(hermesTagDefinitions.name))
		.all()
		.filter((row) => !normalizedQuery || row.normalizedKey.includes(normalizedQuery))
		.map(definitionFromRow);
}

function createDefinitionInStore(
	db: DatabaseStore,
	input: HermesTagScope & { name: string; color: HermesTagColor }
): DefinitionRow {
	const name = normalizeHermesSessionTag(input.name);
	const normalizedKey = normalizeHermesTagKey(name);
	assertColor(input.color);
	if (selectDefinitionByKey(db, input, normalizedKey)) throw new HermesTagConflictError();
	const now = new Date();
	const row = {
		id: nanoid(),
		managerId: input.managerId,
		connectionId: input.connectionId,
		profileId: input.profileId,
		name,
		normalizedKey,
		color: input.color,
		revision: 0,
		createdAt: now,
		updatedAt: now,
	};
	try {
		db.insert(hermesTagDefinitions).values(row).run();
	} catch (error) {
		if (selectDefinitionByKey(db, input, normalizedKey)) throw new HermesTagConflictError();
		throw error;
	}
	return row;
}

export function createHermesTagDefinition(
	input: HermesTagScope & { name: string; color: HermesTagColor }
): HermesTagDefinition {
	return definitionFromRow(getDb().transaction((tx) => createDefinitionInStore(tx, input)));
}

export function upsertHermesTagDefinition(
	input: HermesTagScope & { name: string; color: HermesTagColor }
): { definition: HermesTagDefinition; created: boolean } {
	const name = normalizeHermesSessionTag(input.name);
	assertColor(input.color);
	return getDb().transaction((tx) => {
		const existing = selectDefinitionByKey(tx, input, normalizeHermesTagKey(name));
		if (existing) return { definition: definitionFromRow(existing), created: false };
		return {
			definition: definitionFromRow(createDefinitionInStore(tx, { ...input, name })),
			created: true,
		};
	});
}

export function updateHermesTagDefinition(
	input: HermesTagScope & {
		definitionId: string;
		name?: string;
		color?: HermesTagColor;
		expectedRevision: number;
	}
): HermesTagDefinition {
	if (input.color !== undefined) assertColor(input.color);
	return getDb().transaction((tx) => {
		const current = selectDefinition(tx, input, input.definitionId);
		if (!current) throw new HermesTagNotFoundError();
		if (current.revision !== input.expectedRevision)
			throw new HermesTagConflictError(
				"Tag changed elsewhere. Refresh and try again.",
				"revision_conflict"
			);
		const name = input.name === undefined ? current.name : normalizeHermesSessionTag(input.name);
		const normalizedKey = normalizeHermesTagKey(name);
		const color = input.color ?? current.color;
		if (name === current.name && color === current.color) return definitionFromRow(current);
		const duplicate = selectDefinitionByKey(tx, input, normalizedKey);
		if (duplicate && duplicate.id !== current.id) throw new HermesTagConflictError();
		const now = new Date();
		const updated = tx
			.update(hermesTagDefinitions)
			.set({ name, normalizedKey, color, revision: current.revision + 1, updatedAt: now })
			.where(
				and(definitionWhere(input, current.id), eq(hermesTagDefinitions.revision, current.revision))
			)
			.run();
		if (updated.changes !== 1)
			throw new HermesTagConflictError(
				"Tag changed elsewhere. Refresh and try again.",
				"revision_conflict"
			);
		if (name !== current.name) {
			const sessions = tx
				.select({
					managerId: hermesSessionTagAssignments.managerId,
					connectionId: hermesSessionTagAssignments.connectionId,
					profileId: hermesSessionTagAssignments.profileId,
					durableSessionId: hermesSessionTagAssignments.durableSessionId,
				})
				.from(hermesSessionTagAssignments)
				.where(
					and(
						eq(hermesSessionTagAssignments.managerId, input.managerId),
						eq(hermesSessionTagAssignments.connectionId, input.connectionId),
						eq(hermesSessionTagAssignments.profileId, input.profileId),
						eq(hermesSessionTagAssignments.definitionId, current.id)
					)
				)
				.all();
			for (const identity of sessions) syncLegacyTagsJson(tx, identity);
		}
		return definitionFromRow({
			...current,
			name,
			normalizedKey,
			color,
			revision: current.revision + 1,
			updatedAt: now,
		});
	});
}

function bumpMetadataForAssignment(
	db: DatabaseStore,
	identity: HermesSessionMetadataIdentity
): void {
	const row = selectMetadataRow(db, identity);
	replaceMetadataRow(db, identity, row, {
		customTitle: titleFromRow(row?.customTitle ?? null),
		revision: (row?.revision ?? 0) + 1,
		now: new Date(),
	});
}

function assignInStore(
	db: DatabaseStore,
	identity: HermesSessionMetadataIdentity,
	definitionId: string
): HermesSessionMetadataState {
	if (!selectDefinition(db, identity, definitionId)) throw new HermesTagNotFoundError();
	const existing = db
		.select()
		.from(hermesSessionTagAssignments)
		.where(
			and(
				assignmentIdentityWhere(identity),
				eq(hermesSessionTagAssignments.definitionId, definitionId)
			)
		)
		.get();
	if (existing) {
		syncLegacyTagsJson(db, identity);
		return stateFromStore(db, identity);
	}
	const assignments = db
		.select({ position: hermesSessionTagAssignments.position })
		.from(hermesSessionTagAssignments)
		.where(assignmentIdentityWhere(identity))
		.all();
	if (assignments.length >= HERMES_SESSION_TAG_LIMIT) {
		throw new Error(`Sessions can have at most ${HERMES_SESSION_TAG_LIMIT} tags`);
	}
	db.insert(hermesSessionTagAssignments)
		.values({
			...identity,
			definitionId,
			position: assignments.reduce((maximum, row) => Math.max(maximum, row.position), -1) + 1,
			assignedAt: new Date(),
		})
		.run();
	bumpMetadataForAssignment(db, identity);
	syncLegacyTagsJson(db, identity);
	return stateFromStore(db, identity);
}

export function assignHermesSessionTag(
	input: HermesSessionMetadataIdentity & { definitionId: string }
): HermesSessionMetadataState {
	const { definitionId, ...identity } = input;
	return getDb().transaction((tx) => assignInStore(tx, identity, definitionId));
}

export function unassignHermesSessionTag(
	input: HermesSessionMetadataIdentity & { definitionId: string }
): HermesSessionMetadataState {
	const { definitionId, ...identity } = input;
	return getDb().transaction((tx) => {
		const removed = tx
			.delete(hermesSessionTagAssignments)
			.where(
				and(
					assignmentIdentityWhere(identity),
					eq(hermesSessionTagAssignments.definitionId, definitionId)
				)
			)
			.run();
		if (removed.changes === 0) return stateFromStore(tx, identity);
		bumpMetadataForAssignment(tx, identity);
		syncLegacyTagsJson(tx, identity);
		return stateFromStore(tx, identity);
	});
}

export function deleteHermesTagDefinition(
	input: HermesTagScope & { definitionId: string; expectedRevision: number }
): { detachedSessionCount: number } {
	return getDb().transaction((tx) => {
		const current = selectDefinition(tx, input, input.definitionId);
		if (!current) throw new HermesTagNotFoundError();
		if (current.revision !== input.expectedRevision)
			throw new HermesTagConflictError(
				"Tag changed elsewhere. Refresh and try again.",
				"revision_conflict"
			);
		const sessions = tx
			.select({
				managerId: hermesSessionTagAssignments.managerId,
				connectionId: hermesSessionTagAssignments.connectionId,
				profileId: hermesSessionTagAssignments.profileId,
				durableSessionId: hermesSessionTagAssignments.durableSessionId,
			})
			.from(hermesSessionTagAssignments)
			.where(
				and(
					eq(hermesSessionTagAssignments.managerId, input.managerId),
					eq(hermesSessionTagAssignments.connectionId, input.connectionId),
					eq(hermesSessionTagAssignments.profileId, input.profileId),
					eq(hermesSessionTagAssignments.definitionId, input.definitionId)
				)
			)
			.all();
		for (const identity of sessions) bumpMetadataForAssignment(tx, identity);
		const deleted = tx
			.delete(hermesTagDefinitions)
			.where(
				and(
					definitionWhere(input, input.definitionId),
					eq(hermesTagDefinitions.revision, current.revision)
				)
			)
			.run();
		if (deleted.changes < 1)
			throw new HermesTagConflictError(
				"Tag changed elsewhere. Refresh and try again.",
				"revision_conflict"
			);
		for (const identity of sessions) syncLegacyTagsJson(tx, identity);
		return { detachedSessionCount: sessions.length };
	});
}

export function setHermesSessionTags(
	input: HermesSessionMetadataIdentity & { tags: string[]; expectedRevision: number }
): HermesSessionMetadataState {
	const { tags, expectedRevision, ...identity } = input;
	const names = normalizeLegacyTagNames(tags);
	return getDb().transaction((tx) => {
		const metadata = selectMetadataRow(tx, identity);
		if ((metadata?.revision ?? 0) !== expectedRevision)
			throw new HermesSessionMetadataConflictError();
		const definitions = names.map((name) => {
			const key = normalizeHermesTagKey(name);
			return (
				selectDefinitionByKey(tx, identity, key) ??
				createDefinitionInStore(tx, { ...identity, name, color: "gray" })
			);
		});
		const current = assignedDefinitions(tx, identity);
		if (
			current.length === definitions.length &&
			current.every((definition, index) => definition.id === definitions[index]?.id)
		) {
			syncLegacyTagsJson(tx, identity);
			return stateFromStore(tx, identity);
		}
		tx.delete(hermesSessionTagAssignments).where(assignmentIdentityWhere(identity)).run();
		const now = new Date();
		if (definitions.length > 0) {
			tx.insert(hermesSessionTagAssignments)
				.values(
					definitions.map((definition, position) => ({
						...identity,
						definitionId: definition.id,
						position,
						assignedAt: now,
					}))
				)
				.run();
		}
		replaceMetadataRow(tx, identity, metadata, {
			customTitle: titleFromRow(metadata?.customTitle ?? null),
			revision: expectedRevision + 1,
			now,
		});
		syncLegacyTagsJson(tx, identity);
		return stateFromStore(tx, identity);
	});
}

export function addHermesSessionTag(
	input: HermesSessionMetadataIdentity & { tag: string }
): HermesSessionMetadataState {
	const { tag, ...identity } = input;
	const name = normalizeHermesSessionTag(tag);
	return getDb().transaction((tx) => {
		const definition =
			selectDefinitionByKey(tx, identity, normalizeHermesTagKey(name)) ??
			createDefinitionInStore(tx, { ...identity, name, color: "gray" });
		return assignInStore(tx, identity, definition.id);
	});
}

export function removeHermesSessionTag(
	input: HermesSessionMetadataIdentity & { tag: string }
): HermesSessionMetadataState {
	const { tag, ...identity } = input;
	const definition = selectDefinitionByKey(getDb(), identity, normalizeHermesTagKey(tag));
	if (!definition) return getHermesSessionMetadata(identity);
	return unassignHermesSessionTag({ ...identity, definitionId: definition.id });
}

function parseLegacyTags(value: string): string[] {
	try {
		const parsed: unknown = JSON.parse(value);
		if (!Array.isArray(parsed)) return [];
		const result: string[] = [];
		const seen = new Set<string>();
		for (const candidate of parsed) {
			if (typeof candidate !== "string") continue;
			try {
				const name = normalizeHermesSessionTag(candidate);
				const key = normalizeHermesTagKey(name);
				if (seen.has(key)) continue;
				seen.add(key);
				result.push(name);
				if (result.length === HERMES_SESSION_TAG_LIMIT) break;
			} catch {
				// A malformed legacy entry cannot prevent neighboring valid tags from migrating.
			}
		}
		return result;
	} catch {
		return [];
	}
}

export function backfillLegacyHermesSessionTags(): {
	definitionsCreated: number;
	assignmentsCreated: number;
} {
	return getDb().transaction((tx) => {
		let definitionsCreated = 0;
		let assignmentsCreated = 0;
		for (const metadata of tx.select().from(hermesSessionMetadata).all()) {
			const identity: HermesSessionMetadataIdentity = {
				managerId: metadata.managerId,
				connectionId: metadata.connectionId,
				profileId: metadata.profileId,
				durableSessionId: metadata.durableSessionId,
			};
			const existingAssignments = new Set(
				tx
					.select({ definitionId: hermesSessionTagAssignments.definitionId })
					.from(hermesSessionTagAssignments)
					.where(assignmentIdentityWhere(identity))
					.all()
					.map((row) => row.definitionId)
			);
			for (const [position, name] of parseLegacyTags(metadata.legacyTagsJson).entries()) {
				const key = normalizeHermesTagKey(name);
				let definition = selectDefinitionByKey(tx, identity, key);
				if (!definition) {
					definition = createDefinitionInStore(tx, { ...identity, name, color: "gray" });
					definitionsCreated++;
				}
				if (existingAssignments.has(definition.id)) continue;
				tx.insert(hermesSessionTagAssignments)
					.values({
						...identity,
						definitionId: definition.id,
						position,
						assignedAt: metadata.updatedAt,
					})
					.run();
				existingAssignments.add(definition.id);
				assignmentsCreated++;
			}
			syncLegacyTagsJson(tx, identity);
		}
		return { definitionsCreated, assignmentsCreated };
	});
}

export function deleteHermesSessionMetadata(identity: HermesSessionMetadataIdentity): void {
	getDb().transaction((tx) => {
		tx.delete(hermesSessionTagAssignments).where(assignmentIdentityWhere(identity)).run();
		tx.delete(hermesSessionMetadata).where(identityWhere(identity)).run();
	});
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
