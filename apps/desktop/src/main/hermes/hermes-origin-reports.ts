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
	return {
		connectionId: row.connectionId,
		hermesSessionId: row.hermesSessionId,
		messageId: row.messageKey,
		status: statusOverride ?? row.status,
		retryable: row.retryable,
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
		if (row.status === "sent" || row.status === "sending") {
			return { state: toState(row, "duplicate-suppressed"), shouldSend: false };
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
	const where = reportWhere(input, identity);
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
	const row = db.select().from(hermesOriginReports).where(where).get();
	if (!row) throw new Error("Hermes report receipt was not found");
	return toState(row);
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
