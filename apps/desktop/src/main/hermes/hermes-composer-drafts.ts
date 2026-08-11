import { and, eq } from "drizzle-orm";
import type { HermesComposerDraftIdentity } from "../../shared/hermes";
import { getDb } from "../db";
import { hermesComposerDrafts } from "../db/schema";

function persistedScopePart(value: string | null): string {
	return value ?? "";
}

function draftPredicate(identity: HermesComposerDraftIdentity) {
	return and(
		eq(hermesComposerDrafts.managerId, persistedScopePart(identity.managerId)),
		eq(hermesComposerDrafts.projectId, persistedScopePart(identity.projectId)),
		eq(hermesComposerDrafts.connectionId, identity.connectionId),
		eq(hermesComposerDrafts.profileId, identity.profileId),
		eq(hermesComposerDrafts.durableSessionId, identity.durableSessionId)
	);
}

export function getHermesComposerDraft(identity: HermesComposerDraftIdentity): string {
	return (
		getDb()
			.select({ text: hermesComposerDrafts.text })
			.from(hermesComposerDrafts)
			.where(draftPredicate(identity))
			.get()?.text ?? ""
	);
}

export function setHermesComposerDraft(identity: HermesComposerDraftIdentity, text: string): void {
	const db = getDb();
	if (text.length === 0) {
		db.delete(hermesComposerDrafts).where(draftPredicate(identity)).run();
		return;
	}

	const values = {
		managerId: persistedScopePart(identity.managerId),
		projectId: persistedScopePart(identity.projectId),
		connectionId: identity.connectionId,
		profileId: identity.profileId,
		durableSessionId: identity.durableSessionId,
		text,
		updatedAt: new Date(),
	};
	db.insert(hermesComposerDrafts)
		.values(values)
		.onConflictDoUpdate({
			target: [
				hermesComposerDrafts.managerId,
				hermesComposerDrafts.projectId,
				hermesComposerDrafts.connectionId,
				hermesComposerDrafts.profileId,
				hermesComposerDrafts.durableSessionId,
			],
			set: { text: values.text, updatedAt: values.updatedAt },
		})
		.run();
}
