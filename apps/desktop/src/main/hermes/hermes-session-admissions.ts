import { and, asc, eq, sql } from "drizzle-orm";
import type { HermesSessionMetadata } from "../../shared/control-plane";
import type { HermesSessionSummary } from "../../shared/hermes";
import { getDb } from "../db";
import { hermesSessionAdmissions } from "../db/schema";

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
		const admission = admittedBySession.get(`${session.profileId}\0${session.id}`);
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
