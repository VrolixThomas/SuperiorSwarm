import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { HermesOriginReportState } from "../../shared/hermes";
import { getDb } from "../db";
import { hermesOriginReports } from "../db/schema";

function reportIdentity(connectionId: string, hermesSessionId: string, turnId: string) {
	const digest = createHash("sha256")
		.update(`${connectionId}\0${hermesSessionId}\0${turnId}`)
		.digest("hex");
	return {
		id: `hermes-report-${digest.slice(0, 24)}`,
		idempotencyKey: `superiorswarm-${digest}`,
	};
}

function toState(row: typeof hermesOriginReports.$inferSelect): HermesOriginReportState {
	return {
		connectionId: row.connectionId,
		hermesSessionId: row.hermesSessionId,
		turnId: row.turnId,
		status: row.status,
		retryable: row.retryable,
		messageId: row.messageId,
		permalink: row.permalink,
		errorCode: row.errorCode,
		updatedAt: row.updatedAt.getTime(),
	};
}

export function beginHermesOriginReport(input: {
	connectionId: string;
	hermesSessionId: string;
	turnId: string;
}): { state: HermesOriginReportState; idempotencyKey: string; alreadyDelivered: boolean } {
	const db = getDb();
	const identity = reportIdentity(input.connectionId, input.hermesSessionId, input.turnId);
	const where = and(
		eq(hermesOriginReports.connectionId, input.connectionId),
		eq(hermesOriginReports.hermesSessionId, input.hermesSessionId),
		eq(hermesOriginReports.turnId, input.turnId)
	);
	const existing = db.select().from(hermesOriginReports).where(where).get();
	if (existing?.status === "sent" || existing?.status === "duplicate-suppressed") {
		return {
			state: toState(existing),
			idempotencyKey: existing.idempotencyKey,
			alreadyDelivered: true,
		};
	}
	const now = new Date();
	db.insert(hermesOriginReports)
		.values({
			id: existing?.id ?? identity.id,
			connectionId: input.connectionId,
			hermesSessionId: input.hermesSessionId,
			turnId: input.turnId,
			idempotencyKey: existing?.idempotencyKey ?? identity.idempotencyKey,
			status: "pending",
			retryable: false,
			messageId: existing?.messageId ?? null,
			permalink: existing?.permalink ?? null,
			errorCode: null,
			createdAt: existing?.createdAt ?? now,
			updatedAt: now,
		})
		.onConflictDoUpdate({
			target: [
				hermesOriginReports.connectionId,
				hermesOriginReports.hermesSessionId,
				hermesOriginReports.turnId,
			],
			set: { status: "pending", retryable: false, errorCode: null, updatedAt: now },
		})
		.run();
	const pending = db.select().from(hermesOriginReports).where(where).get();
	if (!pending) throw new Error("Hermes origin report could not be recorded");
	return {
		state: toState(pending),
		idempotencyKey: pending.idempotencyKey,
		alreadyDelivered: false,
	};
}

export function finishHermesOriginReport(input: {
	connectionId: string;
	hermesSessionId: string;
	turnId: string;
	status: "sent" | "failed" | "duplicate-suppressed";
	retryable?: boolean;
	messageId?: string | null;
	permalink?: string | null;
	errorCode?: string | null;
}): HermesOriginReportState {
	const db = getDb();
	const where = and(
		eq(hermesOriginReports.connectionId, input.connectionId),
		eq(hermesOriginReports.hermesSessionId, input.hermesSessionId),
		eq(hermesOriginReports.turnId, input.turnId)
	);
	db.update(hermesOriginReports)
		.set({
			status: input.status,
			retryable: input.retryable ?? false,
			messageId: input.messageId ?? null,
			permalink: input.permalink ?? null,
			errorCode: input.errorCode ?? null,
			updatedAt: new Date(),
		})
		.where(where)
		.run();
	const row = db.select().from(hermesOriginReports).where(where).get();
	if (!row) throw new Error("Hermes origin report receipt was not found");
	return toState(row);
}

export function listHermesOriginReports(
	connectionId: string,
	hermesSessionId: string
): HermesOriginReportState[] {
	return getDb()
		.select()
		.from(hermesOriginReports)
		.where(
			and(
				eq(hermesOriginReports.connectionId, connectionId),
				eq(hermesOriginReports.hermesSessionId, hermesSessionId)
			)
		)
		.all()
		.map(toState);
}
