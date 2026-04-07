/**
 * Pure helpers used by PullRequestsTab and PullRequestGroup.
 * Extracted as standalone functions so they can be unit-tested with bun:test
 * without needing a React rendering harness.
 */

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
