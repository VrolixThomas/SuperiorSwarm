import type { HermesComposerDraftIdentity } from "../../shared/hermes";
import { trpcVanilla } from "../trpc/client";
import { HermesComposerDraftCoordinator } from "./hermes-composer-draft-coordinator";

function remoteScope(identity: HermesComposerDraftIdentity) {
	return {
		connectionId: identity.connectionId,
		projectId: identity.projectId,
		profileId: identity.profileId,
		durableSessionId: identity.durableSessionId,
	};
}

/** Shared across Hermes view mounts so pending writes and exact local text survive tab changes. */
export const hermesComposerDrafts = new HermesComposerDraftCoordinator({
	load: (identity) => trpcVanilla.hermes.composerDraft.query(remoteScope(identity)),
	save: async (identity, text) => {
		await trpcVanilla.hermes.setComposerDraft.mutate({ ...remoteScope(identity), text });
	},
});
