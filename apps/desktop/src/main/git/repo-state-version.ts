const versions = new Map<string, number>();

export function getRepoStateVersion(repoPath: string): number {
	return versions.get(repoPath) ?? 0;
}

export function bumpRepoStateVersion(repoPath: string): number {
	const next = (versions.get(repoPath) ?? 0) + 1;
	versions.set(repoPath, next);
	return next;
}
