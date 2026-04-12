/**
 * Helpers used by PullRequestsTab, PullRequestGroup, and PRControlRail.
 */

import type { PRContext } from "../../shared/github-types";
import { getAllPanes, usePaneStore } from "../stores/pane-store";

interface ProjectLike {
	name: string;
	remoteOwner: string | null;
	remoteRepo: string | null;
}

/**
 * Given a PR group's owner+repo, return the local Project.name if the repo
 * is cloned locally, otherwise the `owner/repo` string.
 *
 * This makes the PRs tab show the same display name the Repos tab uses
 * (e.g., `portal` instead of `slotsgames/portal`) when the repo exists locally,
 * while still rendering useful info for remote-only PRs.
 */
export function resolveDisplayName(
	group: { owner: string; repo: string },
	projectsList: ProjectLike[] | undefined
): string {
	const project = projectsList?.find(
		(p) => p.remoteOwner === group.owner && p.remoteRepo === group.repo
	);
	return project?.name ?? `${group.owner}/${group.repo}`;
}

/**
 * Given a map of PR identifier → workspace ID, return the identifier whose
 * workspace ID matches `activeWorkspaceId`, or null if none match.
 *
 * Used to mark exactly one PR row as "active" in the PRs tab, mirroring the
 * way the Repos tab marks one workspace row as active.
 */
export function findActivePRIdentifier(
	workspaceIdMap: Map<string, string>,
	activeWorkspaceId: string
): string | null {
	if (!activeWorkspaceId) return null;
	for (const [identifier, wsId] of workspaceIdMap.entries()) {
		if (wsId === activeWorkspaceId) return identifier;
	}
	return null;
}

/** Find the PR overview tab for the given PR and split it into its own pane (right). */
export function splitPROverviewRight(workspaceId: string, ctx: PRContext): void {
	const paneStore = usePaneStore.getState();
	const layout = paneStore.layouts[workspaceId];
	if (!layout) return;
	for (const pane of getAllPanes(layout)) {
		const overviewTab = pane.tabs.find(
			(t) =>
				t.kind === "pr-overview" &&
				t.prCtx.owner === ctx.owner &&
				t.prCtx.repo === ctx.repo &&
				t.prCtx.number === ctx.number
		);
		if (overviewTab) {
			paneStore.splitPane(workspaceId, pane.id, "horizontal", overviewTab);
			return;
		}
	}
}
