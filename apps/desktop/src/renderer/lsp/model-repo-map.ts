const modelRepoMap = new Map<string, string>();

export function setModelRepoPath(uri: string, repoPath: string): void {
	modelRepoMap.set(uri, repoPath);
}

export function clearModelRepoPath(uri: string): void {
	modelRepoMap.delete(uri);
}

export function getModelRepoPath(uri: string): string | null {
	return modelRepoMap.get(uri) ?? null;
}

export function findRepoPathFromUri(uri: string): string | null {
	for (const [, repoPath] of modelRepoMap) {
		if (uri.startsWith(`file://${repoPath}`)) return repoPath;
	}
	return null;
}

export function clearAllModelRepoPaths(): void {
	modelRepoMap.clear();
}
