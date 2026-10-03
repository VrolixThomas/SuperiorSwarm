/** Visibility and explicit local editing remain allowed; automatic content use does not. */
export function isSensitiveFilePath(path: string): boolean {
	return (path.split(/[\\/]/).pop() ?? "").toLowerCase().startsWith(".env");
}

export function isSensitiveDocumentUri(uri: string): boolean {
	try {
		return isSensitiveFilePath(decodeURIComponent(new URL(uri).pathname));
	} catch {
		return true;
	}
}
