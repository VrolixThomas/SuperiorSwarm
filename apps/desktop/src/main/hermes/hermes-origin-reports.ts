import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { HermesOriginReportState } from "../../shared/hermes";
import { getDb } from "../db";
import { hermesOriginReports } from "../db/schema";

interface HermesOriginReportIdentityInput {
	connectionId: string;
	profileId: string;
	hermesSessionId: string;
	messageId: string | null;
	content: string;
	destinationFingerprint: string;
}

interface ReportIdentity {
	id: string;
	messageKey: string;
	contentHash: string;
}

const activeReportAttemptCounts = new Map<string, number>();
const migratedActiveReportIds = new Map<string, string>();

function activeAttemptCount(id: string): number {
	return activeReportAttemptCounts.get(id) ?? 0;
}

function addActiveAttempt(id: string, count = 1): void {
	activeReportAttemptCounts.set(id, activeAttemptCount(id) + count);
}

function finishActiveAttempt(id: string): void {
	const remaining = activeAttemptCount(id) - 1;
	if (remaining > 0) {
		activeReportAttemptCounts.set(id, remaining);
		return;
	}
	activeReportAttemptCounts.delete(id);
	for (const [sourceId, targetId] of migratedActiveReportIds) {
		if (targetId === id) migratedActiveReportIds.delete(sourceId);
	}
}

export function remapActiveHermesOriginReportAttempt(
	previousId: string,
	canonicalId: string
): void {
	const previousCount = activeAttemptCount(previousId);
	if (previousCount === 0) return;
	activeReportAttemptCounts.delete(previousId);
	addActiveAttempt(canonicalId, previousCount);
	for (const [sourceId, targetId] of migratedActiveReportIds) {
		if (targetId === previousId) migratedActiveReportIds.set(sourceId, canonicalId);
	}
	migratedActiveReportIds.set(previousId, canonicalId);
}

function normalizedContent(value: string): string {
	return value.replace(/\r\n/g, "\n").trim();
}

function reportIdentity(input: HermesOriginReportIdentityInput): ReportIdentity {
	const contentHash = createHash("sha256").update(normalizedContent(input.content)).digest("hex");
	const messageKey = input.messageId?.trim() || `content:${contentHash}`;
	const digest = createHash("sha256")
		.update(
			`${input.connectionId}\0${input.profileId}\0${input.hermesSessionId}\0${messageKey}\0${input.destinationFingerprint}`
		)
		.digest("hex");
	return { id: `hermes-report-${digest.slice(0, 24)}`, messageKey, contentHash };
}

function reportWhere(input: HermesOriginReportIdentityInput, identity: ReportIdentity) {
	return and(
		eq(hermesOriginReports.connectionId, input.connectionId),
		eq(hermesOriginReports.profileId, input.profileId),
		eq(hermesOriginReports.hermesSessionId, input.hermesSessionId),
		eq(hermesOriginReports.messageKey, identity.messageKey),
		eq(hermesOriginReports.destinationFingerprint, input.destinationFingerprint)
	);
}

function toState(
	row: typeof hermesOriginReports.$inferSelect,
	statusOverride?: HermesOriginReportState["status"]
): HermesOriginReportState {
	const orphanedSending = row.status === "sending" && activeAttemptCount(row.id) === 0;
	return {
		connectionId: row.connectionId,
		hermesSessionId: row.hermesSessionId,
		messageId: row.messageKey,
		status: statusOverride ?? row.status,
		retryable: orphanedSending || row.retryable,
		providerMessageId: row.providerMessageId,
		errorCode: row.errorCode,
		attemptCount: row.attemptCount,
		updatedAt: row.updatedAt.getTime(),
	};
}

function insertPending(
	db: ReturnType<typeof getDb>,
	input: HermesOriginReportIdentityInput,
	identity: ReportIdentity
): typeof hermesOriginReports.$inferSelect {
	const now = new Date();
	db.insert(hermesOriginReports)
		.values({
			id: identity.id,
			connectionId: input.connectionId,
			profileId: input.profileId,
			hermesSessionId: input.hermesSessionId,
			messageKey: identity.messageKey,
			contentHash: identity.contentHash,
			destinationFingerprint: input.destinationFingerprint,
			status: "pending",
			retryable: false,
			providerMessageId: null,
			errorCode: null,
			attemptCount: 0,
			createdAt: now,
			updatedAt: now,
		})
		.onConflictDoNothing()
		.run();
	const row = db.select().from(hermesOriginReports).where(reportWhere(input, identity)).get();
	if (!row) throw new Error("Hermes report receipt could not be prepared");
	return row;
}

export function prepareHermesOriginReport(
	input: HermesOriginReportIdentityInput
): HermesOriginReportState {
	const db = getDb();
	const identity = reportIdentity(input);
	const existing = db.select().from(hermesOriginReports).where(reportWhere(input, identity)).get();
	return toState(existing ?? insertPending(db, input, identity));
}

export function beginHermesOriginReportAttempt(
	input: HermesOriginReportIdentityInput & { explicitRetry: boolean }
): { state: HermesOriginReportState; shouldSend: boolean } {
	const db = getDb();
	const identity = reportIdentity(input);
	return db.transaction((tx) => {
		let row = tx.select().from(hermesOriginReports).where(reportWhere(input, identity)).get();
		if (!row) {
			const now = new Date();
			tx.insert(hermesOriginReports)
				.values({
					id: identity.id,
					connectionId: input.connectionId,
					profileId: input.profileId,
					hermesSessionId: input.hermesSessionId,
					messageKey: identity.messageKey,
					contentHash: identity.contentHash,
					destinationFingerprint: input.destinationFingerprint,
					status: "pending",
					retryable: false,
					providerMessageId: null,
					errorCode: null,
					attemptCount: 0,
					createdAt: now,
					updatedAt: now,
				})
				.onConflictDoNothing()
				.run();
			row = tx.select().from(hermesOriginReports).where(reportWhere(input, identity)).get();
		}
		if (!row) throw new Error("Hermes report receipt could not be claimed");
		if (row.status === "sent" || activeAttemptCount(row.id) > 0) {
			return { state: toState(row, "duplicate-suppressed"), shouldSend: false };
		}
		if (row.status === "sending" && !input.explicitRetry) {
			return { state: toState(row), shouldSend: false };
		}
		if (row.status === "failed" && (!input.explicitRetry || !row.retryable)) {
			return { state: toState(row), shouldSend: false };
		}
		const now = new Date();
		tx.update(hermesOriginReports)
			.set({
				status: "sending",
				retryable: false,
				providerMessageId: null,
				errorCode: null,
				attemptCount: row.attemptCount + 1,
				updatedAt: now,
			})
			.where(eq(hermesOriginReports.id, row.id))
			.run();
		const sending = tx
			.select()
			.from(hermesOriginReports)
			.where(eq(hermesOriginReports.id, row.id))
			.get();
		if (!sending) throw new Error("Hermes report receipt disappeared during send");
		addActiveAttempt(row.id);
		return { state: toState(sending), shouldSend: true };
	});
}

export function finishHermesOriginReport(
	input: HermesOriginReportIdentityInput & {
		status: "sent" | "failed";
		retryable: boolean;
		providerMessageId?: string | null;
		errorCode?: string | null;
	}
): HermesOriginReportState {
	const db = getDb();
	const identity = reportIdentity(input);
	const migratedId = migratedActiveReportIds.get(identity.id);
	const where = migratedId ? eq(hermesOriginReports.id, migratedId) : reportWhere(input, identity);
	const targetId = migratedId ?? identity.id;
	try {
		const current = db.select().from(hermesOriginReports).where(where).get();
		if (!current) throw new Error("Hermes report receipt was not found");
		const otherAttemptsRemain = activeAttemptCount(targetId) > 1;
		if (current.status !== "sent" && !(input.status === "failed" && otherAttemptsRemain)) {
			db.update(hermesOriginReports)
				.set({
					status: input.status,
					retryable: input.retryable,
					providerMessageId: input.providerMessageId ?? null,
					errorCode: input.errorCode ?? null,
					updatedAt: new Date(),
				})
				.where(where)
				.run();
		}
		const row = db.select().from(hermesOriginReports).where(where).get();
		if (!row) throw new Error("Hermes report receipt was not found");
		return toState(row);
	} finally {
		finishActiveAttempt(targetId);
		migratedActiveReportIds.delete(identity.id);
	}
}

export function listHermesOriginReports(
	connectionId: string,
	profileId: string,
	hermesSessionId: string
): HermesOriginReportState[] {
	return getDb()
		.select()
		.from(hermesOriginReports)
		.where(
			and(
				eq(hermesOriginReports.connectionId, connectionId),
				eq(hermesOriginReports.profileId, profileId),
				eq(hermesOriginReports.hermesSessionId, hermesSessionId)
			)
		)
		.all()
		.map((row) => toState(row));
}

function clearActiveReportIds(ids: Iterable<string>): void {
	for (const id of ids) {
		activeReportAttemptCounts.delete(id);
		migratedActiveReportIds.delete(id);
		for (const [sourceId, targetId] of migratedActiveReportIds) {
			if (targetId === id) migratedActiveReportIds.delete(sourceId);
		}
	}
}

export function clearHermesOriginReportAttemptsForConnection(connectionId: string): void {
	const ids = getDb()
		.select({ id: hermesOriginReports.id })
		.from(hermesOriginReports)
		.where(eq(hermesOriginReports.connectionId, connectionId))
		.all()
		.map((row) => row.id);
	clearActiveReportIds(ids);
}

export function deleteHermesOriginReports(
	connectionId: string,
	profileId: string,
	hermesSessionId: string
): void {
	const db = getDb();
	const predicate = and(
		eq(hermesOriginReports.connectionId, connectionId),
		eq(hermesOriginReports.profileId, profileId),
		eq(hermesOriginReports.hermesSessionId, hermesSessionId)
	);
	const rows = db
		.select({ id: hermesOriginReports.id })
		.from(hermesOriginReports)
		.where(predicate)
		.all();
	db.delete(hermesOriginReports).where(predicate).run();
	clearActiveReportIds(rows.map((row) => row.id));
}
