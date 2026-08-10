import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { hermesOriginLinks } from "../db/schema";
import { validateManualSlackThreadUrl } from "./hermes-origin-resolver";

interface HermesOriginLinkIdentity {
	connectionId: string;
	profileId: string;
	hermesSessionId: string;
	originFingerprint: string;
}

function identityWhere(input: HermesOriginLinkIdentity) {
	return and(
		eq(hermesOriginLinks.connectionId, input.connectionId),
		eq(hermesOriginLinks.profileId, input.profileId),
		eq(hermesOriginLinks.hermesSessionId, input.hermesSessionId)
	);
}

function linkId(input: HermesOriginLinkIdentity): string {
	const digest = createHash("sha256")
		.update(`${input.connectionId}\0${input.profileId}\0${input.hermesSessionId}`)
		.digest("hex");
	return `hermes-origin-${digest.slice(0, 24)}`;
}

export function getHermesOriginLink(input: HermesOriginLinkIdentity): string | null {
	const db = getDb();
	const row = db.select().from(hermesOriginLinks).where(identityWhere(input)).get();
	if (!row) return null;
	if (row.platform !== "slack" || row.originFingerprint !== input.originFingerprint) {
		db.delete(hermesOriginLinks).where(eq(hermesOriginLinks.id, row.id)).run();
		return null;
	}
	const validated = validateManualSlackThreadUrl(row.openUrl);
	if (!validated) {
		db.delete(hermesOriginLinks).where(eq(hermesOriginLinks.id, row.id)).run();
		return null;
	}
	return validated;
}

export function saveHermesOriginLink(
	input: HermesOriginLinkIdentity & { openUrl: string }
): string {
	const openUrl = validateManualSlackThreadUrl(input.openUrl);
	if (!openUrl) throw new Error("Enter a trusted HTTPS Slack thread URL");
	const db = getDb();
	const now = new Date();
	db.insert(hermesOriginLinks)
		.values({
			id: linkId(input),
			connectionId: input.connectionId,
			profileId: input.profileId,
			hermesSessionId: input.hermesSessionId,
			platform: "slack",
			openUrl,
			originFingerprint: input.originFingerprint,
			createdAt: now,
			updatedAt: now,
		})
		.onConflictDoUpdate({
			target: [
				hermesOriginLinks.connectionId,
				hermesOriginLinks.profileId,
				hermesOriginLinks.hermesSessionId,
			],
			set: {
				platform: "slack",
				openUrl,
				originFingerprint: input.originFingerprint,
				updatedAt: now,
			},
		})
		.run();
	return openUrl;
}

export function deleteHermesOriginLink(
	connectionId: string,
	profileId: string,
	hermesSessionId: string
): void {
	getDb()
		.delete(hermesOriginLinks)
		.where(
			and(
				eq(hermesOriginLinks.connectionId, connectionId),
				eq(hermesOriginLinks.profileId, profileId),
				eq(hermesOriginLinks.hermesSessionId, hermesSessionId)
			)
		)
		.run();
}
