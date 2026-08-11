import { createHash } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import type { HermesSessionMetadata } from "../../shared/control-plane";
import { type HermesSessionSummary, hermesSessionLineageRootId } from "../../shared/hermes";
import { getDb, schema } from "../db";
import { hermesSessionAdmissions } from "../db/schema";
import { remapActiveHermesOriginReportAttempt } from "./hermes-origin-reports";

export type HermesSessionAdmissionReason = "agents" | "mcp" | "handover";

export type HermesSessionAdmissionResult =
	| {
			admitted: true;
			managerId: string;
			profileId: string;
			durableSessionId: string;
			reason: HermesSessionAdmissionReason;
	  }
	| { admitted: false; code: "cron_session" };

export function admitHermesSession(input: {
	managerId: string;
	metadata: HermesSessionMetadata;
	reason: HermesSessionAdmissionReason;
	now?: Date;
}): HermesSessionAdmissionResult {
	if (input.metadata.isCron || input.metadata.sourcePlatform === "cron") {
		return { admitted: false, code: "cron_session" };
	}
	const now = input.now ?? new Date();
	const admission = getDb()
		.insert(hermesSessionAdmissions)
		.values({
			managerId: input.managerId,
			profileId: input.metadata.profileId,
			durableSessionId: input.metadata.durableSessionId,
			reason: input.reason,
			sourcePlatform: input.metadata.sourcePlatform,
			isCron: false,
			firstSeenAt: now,
			lastSeenAt: now,
		})
		.onConflictDoUpdate({
			target: [
				hermesSessionAdmissions.managerId,
				hermesSessionAdmissions.profileId,
				hermesSessionAdmissions.durableSessionId,
			],
			set: {
				reason: input.reason === "handover" ? "handover" : sql`${hermesSessionAdmissions.reason}`,
				sourcePlatform: input.metadata.sourcePlatform,
				isCron: false,
				lastSeenAt: now,
			},
		})
		.returning({ reason: hermesSessionAdmissions.reason })
		.get();
	if (!admission) throw new Error("Failed to persist Hermes session admission");

	return {
		admitted: true,
		managerId: input.managerId,
		profileId: input.metadata.profileId,
		durableSessionId: input.metadata.durableSessionId,
		reason: admission.reason,
	};
}

export function listHermesSessionAdmissions(managerId: string) {
	return getDb()
		.select()
		.from(hermesSessionAdmissions)
		.where(eq(hermesSessionAdmissions.managerId, managerId))
		.orderBy(asc(hermesSessionAdmissions.firstSeenAt))
		.all();
}

export function deleteHermesSessionAdmission(
	managerId: string,
	profileId: string,
	durableSessionId: string
): void {
	getDb()
		.delete(hermesSessionAdmissions)
		.where(
			and(
				eq(hermesSessionAdmissions.managerId, managerId),
				eq(hermesSessionAdmissions.profileId, profileId),
				eq(hermesSessionAdmissions.durableSessionId, durableSessionId)
			)
		)
		.run();
}

function canonicalWorkspaceLinkId(input: {
	connectionId: string;
	profileId: string;
	durableSessionId: string;
	workspaceId: string;
}): string {
	return `hermes-link-${createHash("sha256")
		.update(
			`${input.connectionId}\0${input.profileId}\0${input.durableSessionId}\0${input.workspaceId}`
		)
		.digest("hex")
		.slice(0, 24)}`;
}

function canonicalOriginLinkId(input: {
	connectionId: string;
	profileId: string;
	durableSessionId: string;
}): string {
	return `hermes-origin-${createHash("sha256")
		.update(`${input.connectionId}\0${input.profileId}\0${input.durableSessionId}`)
		.digest("hex")
		.slice(0, 24)}`;
}

function canonicalOriginReportId(input: {
	connectionId: string;
	profileId: string;
	durableSessionId: string;
	messageKey: string;
	destinationFingerprint: string;
}): string {
	return `hermes-report-${createHash("sha256")
		.update(
			`${input.connectionId}\0${input.profileId}\0${input.durableSessionId}\0${input.messageKey}\0${input.destinationFingerprint}`
		)
		.digest("hex")
		.slice(0, 24)}`;
}

const ORIGIN_REPORT_STATUS_RANK = {
	pending: 0,
	failed: 1,
	sending: 2,
	sent: 3,
} as const;

/**
 * Moves only the exact manager/profile admission proven by a stock durable-transcript
 * compression lineage. Connection/profile workspace ownership and a matching persisted
 * selection move in the same SQLite transaction; unrelated owners remain untouched.
 */
export function canonicalizeHermesCompressionPersistence(input: {
	managerId: string | null;
	connectionId: string;
	profileId: string;
	parentDurableSessionId: string;
	aliasSessionIds: string[];
	canonicalSessionId: string;
}): { admissionCanonicalized: boolean } {
	const aliases = [...new Set([input.parentDurableSessionId, ...input.aliasSessionIds])].filter(
		(sessionId) => sessionId && sessionId !== input.canonicalSessionId
	);
	if (aliases.length === 0) return { admissionCanonicalized: false };

	const activeReportMigrations: Array<{ previousId: string; canonicalId: string }> = [];
	const result = getDb().transaction((tx) => {
		let admissionCanonicalized = false;
		if (input.managerId) {
			const parentAdmission = tx
				.select()
				.from(hermesSessionAdmissions)
				.where(
					and(
						eq(hermesSessionAdmissions.managerId, input.managerId),
						eq(hermesSessionAdmissions.profileId, input.profileId),
						eq(hermesSessionAdmissions.durableSessionId, input.parentDurableSessionId)
					)
				)
				.get();
			if (parentAdmission) {
				const canonicalAdmission = tx
					.select()
					.from(hermesSessionAdmissions)
					.where(
						and(
							eq(hermesSessionAdmissions.managerId, input.managerId),
							eq(hermesSessionAdmissions.profileId, input.profileId),
							eq(hermesSessionAdmissions.durableSessionId, input.canonicalSessionId)
						)
					)
					.get();
				const mergedAdmission = {
					reason:
						parentAdmission.reason === "handover" || canonicalAdmission?.reason === "handover"
							? ("handover" as const)
							: (canonicalAdmission?.reason ?? parentAdmission.reason),
					sourcePlatform: canonicalAdmission?.sourcePlatform ?? parentAdmission.sourcePlatform,
					isCron: false,
					firstSeenAt:
						canonicalAdmission &&
						canonicalAdmission.firstSeenAt.getTime() < parentAdmission.firstSeenAt.getTime()
							? canonicalAdmission.firstSeenAt
							: parentAdmission.firstSeenAt,
					lastSeenAt:
						canonicalAdmission &&
						canonicalAdmission.lastSeenAt.getTime() > parentAdmission.lastSeenAt.getTime()
							? canonicalAdmission.lastSeenAt
							: parentAdmission.lastSeenAt,
				};
				tx.insert(hermesSessionAdmissions)
					.values({
						...parentAdmission,
						durableSessionId: input.canonicalSessionId,
						...mergedAdmission,
					})
					.onConflictDoUpdate({
						target: [
							hermesSessionAdmissions.managerId,
							hermesSessionAdmissions.profileId,
							hermesSessionAdmissions.durableSessionId,
						],
						set: mergedAdmission,
					})
					.run();
				tx.delete(hermesSessionAdmissions)
					.where(
						and(
							eq(hermesSessionAdmissions.managerId, input.managerId),
							eq(hermesSessionAdmissions.profileId, input.profileId),
							eq(hermesSessionAdmissions.durableSessionId, input.parentDurableSessionId)
						)
					)
					.run();
				admissionCanonicalized = true;
			}
		}

		for (const aliasSessionId of aliases) {
			const aliasRows = tx
				.select()
				.from(schema.hermesSessionWorkspaces)
				.where(
					and(
						eq(schema.hermesSessionWorkspaces.connectionId, input.connectionId),
						eq(schema.hermesSessionWorkspaces.profileId, input.profileId),
						eq(schema.hermesSessionWorkspaces.hermesSessionId, aliasSessionId)
					)
				)
				.all();
			for (const aliasRow of aliasRows) {
				const canonicalRow = tx
					.select()
					.from(schema.hermesSessionWorkspaces)
					.where(
						and(
							eq(schema.hermesSessionWorkspaces.connectionId, input.connectionId),
							eq(schema.hermesSessionWorkspaces.profileId, input.profileId),
							eq(schema.hermesSessionWorkspaces.hermesSessionId, input.canonicalSessionId),
							eq(schema.hermesSessionWorkspaces.workspaceId, aliasRow.workspaceId)
						)
					)
					.get();
				tx.delete(schema.hermesSessionWorkspaces)
					.where(eq(schema.hermesSessionWorkspaces.id, aliasRow.id))
					.run();
				if (canonicalRow) {
					tx.update(schema.hermesSessionWorkspaces)
						.set({
							hermesLineageRootId: input.canonicalSessionId,
							source:
								canonicalRow.source === "tool-artifact" || aliasRow.source === "tool-artifact"
									? "tool-artifact"
									: "manual",
							linkedAt:
								canonicalRow.linkedAt.getTime() <= aliasRow.linkedAt.getTime()
									? canonicalRow.linkedAt
									: aliasRow.linkedAt,
						})
						.where(eq(schema.hermesSessionWorkspaces.id, canonicalRow.id))
						.run();
					continue;
				}
				tx.insert(schema.hermesSessionWorkspaces)
					.values({
						id: canonicalWorkspaceLinkId({
							connectionId: input.connectionId,
							profileId: input.profileId,
							durableSessionId: input.canonicalSessionId,
							workspaceId: aliasRow.workspaceId,
						}),
						connectionId: input.connectionId,
						profileId: input.profileId,
						hermesSessionId: input.canonicalSessionId,
						hermesLineageRootId: input.canonicalSessionId,
						workspaceId: aliasRow.workspaceId,
						source: aliasRow.source,
						linkedAt: aliasRow.linkedAt,
					})
					.run();
			}
		}

		const aliasOriginLinks = aliases.flatMap((aliasSessionId) =>
			tx
				.select()
				.from(schema.hermesOriginLinks)
				.where(
					and(
						eq(schema.hermesOriginLinks.connectionId, input.connectionId),
						eq(schema.hermesOriginLinks.profileId, input.profileId),
						eq(schema.hermesOriginLinks.hermesSessionId, aliasSessionId)
					)
				)
				.all()
		);
		const canonicalOriginLink = tx
			.select()
			.from(schema.hermesOriginLinks)
			.where(
				and(
					eq(schema.hermesOriginLinks.connectionId, input.connectionId),
					eq(schema.hermesOriginLinks.profileId, input.profileId),
					eq(schema.hermesOriginLinks.hermesSessionId, input.canonicalSessionId)
				)
			)
			.get();
		const selectedOriginLink =
			canonicalOriginLink ??
			aliasOriginLinks.sort(
				(left, right) => right.updatedAt.getTime() - left.updatedAt.getTime()
			)[0];
		for (const aliasOriginLink of aliasOriginLinks) {
			tx.delete(schema.hermesOriginLinks)
				.where(eq(schema.hermesOriginLinks.id, aliasOriginLink.id))
				.run();
		}
		if (selectedOriginLink && !canonicalOriginLink) {
			tx.insert(schema.hermesOriginLinks)
				.values({
					...selectedOriginLink,
					id: canonicalOriginLinkId({
						connectionId: input.connectionId,
						profileId: input.profileId,
						durableSessionId: input.canonicalSessionId,
					}),
					hermesSessionId: input.canonicalSessionId,
				})
				.run();
		}

		for (const aliasSessionId of aliases) {
			const aliasReports = tx
				.select()
				.from(schema.hermesOriginReports)
				.where(
					and(
						eq(schema.hermesOriginReports.connectionId, input.connectionId),
						eq(schema.hermesOriginReports.profileId, input.profileId),
						eq(schema.hermesOriginReports.hermesSessionId, aliasSessionId)
					)
				)
				.all();
			for (const aliasReport of aliasReports) {
				const canonicalReport = tx
					.select()
					.from(schema.hermesOriginReports)
					.where(
						and(
							eq(schema.hermesOriginReports.connectionId, input.connectionId),
							eq(schema.hermesOriginReports.profileId, input.profileId),
							eq(schema.hermesOriginReports.hermesSessionId, input.canonicalSessionId),
							eq(schema.hermesOriginReports.messageKey, aliasReport.messageKey),
							eq(
								schema.hermesOriginReports.destinationFingerprint,
								aliasReport.destinationFingerprint
							)
						)
					)
					.get();
				tx.delete(schema.hermesOriginReports)
					.where(eq(schema.hermesOriginReports.id, aliasReport.id))
					.run();
				if (!canonicalReport) {
					const canonicalId = canonicalOriginReportId({
						connectionId: input.connectionId,
						profileId: input.profileId,
						durableSessionId: input.canonicalSessionId,
						messageKey: aliasReport.messageKey,
						destinationFingerprint: aliasReport.destinationFingerprint,
					});
					tx.insert(schema.hermesOriginReports)
						.values({
							...aliasReport,
							id: canonicalId,
							hermesSessionId: input.canonicalSessionId,
						})
						.run();
					activeReportMigrations.push({ previousId: aliasReport.id, canonicalId });
					continue;
				}
				const preferred =
					ORIGIN_REPORT_STATUS_RANK[aliasReport.status] >
					ORIGIN_REPORT_STATUS_RANK[canonicalReport.status]
						? aliasReport
						: canonicalReport;
				tx.update(schema.hermesOriginReports)
					.set({
						contentHash: preferred.contentHash,
						status: preferred.status,
						retryable: preferred.status === "failed" ? preferred.retryable : false,
						providerMessageId: preferred.providerMessageId,
						errorCode: preferred.errorCode,
						attemptCount: canonicalReport.attemptCount + aliasReport.attemptCount,
						createdAt:
							canonicalReport.createdAt.getTime() <= aliasReport.createdAt.getTime()
								? canonicalReport.createdAt
								: aliasReport.createdAt,
						updatedAt:
							canonicalReport.updatedAt.getTime() >= aliasReport.updatedAt.getTime()
								? canonicalReport.updatedAt
								: aliasReport.updatedAt,
					})
					.where(eq(schema.hermesOriginReports.id, canonicalReport.id))
					.run();
				activeReportMigrations.push({
					previousId: aliasReport.id,
					canonicalId: canonicalReport.id,
				});
			}
		}

		const selectionRow = tx
			.select({ value: schema.sessionState.value })
			.from(schema.sessionState)
			.where(eq(schema.sessionState.key, "selectedHermesSession"))
			.get();
		if (selectionRow) {
			try {
				const selection: unknown = JSON.parse(selectionRow.value);
				if (
					selection !== null &&
					typeof selection === "object" &&
					"connectionId" in selection &&
					selection.connectionId === input.connectionId &&
					"profileId" in selection &&
					selection.profileId === input.profileId &&
					"sessionId" in selection &&
					typeof selection.sessionId === "string" &&
					aliases.includes(selection.sessionId)
				) {
					tx.update(schema.sessionState)
						.set({
							value: JSON.stringify({
								...selection,
								sessionId: input.canonicalSessionId,
							}),
						})
						.where(eq(schema.sessionState.key, "selectedHermesSession"))
						.run();
				}
			} catch {
				// Malformed renderer-owned state is left untouched and cannot broaden ownership.
			}
		}

		return { admissionCanonicalized };
	});
	for (const migration of activeReportMigrations) {
		remapActiveHermesOriginReportAttempt(migration.previousId, migration.canonicalId);
	}
	return result;
}

export function filterManagedHermesSessionCatalog(input: {
	managerId: string | null;
	sessions: HermesSessionSummary[];
}): HermesSessionSummary[] {
	const admissions = input.managerId ? listHermesSessionAdmissions(input.managerId) : [];
	const admittedBySession = new Map(
		admissions
			.filter((admission) => !admission.isCron)
			.map(
				(admission) => [`${admission.profileId}\0${admission.durableSessionId}`, admission] as const
			)
	);

	return input.sessions.flatMap((session): HermesSessionSummary[] => {
		if (session.isCron || session.source === "cron") return [];
		const admission = admittedBySession.get(
			`${session.profileId}\0${hermesSessionLineageRootId(session)}`
		);
		if (!admission) return [];
		return [
			{
				...session,
				handover: admission.reason === "handover",
				admissionReason: admission.reason,
			},
		];
	});
}
