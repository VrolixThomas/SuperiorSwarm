/** Missing completeness is unknown, never evidence that all changed files were read. */
export function requireCompleteChangedFiles(details: {
	files: Array<{ path: string }>;
	filesComplete?: boolean;
}): string[] {
	if (details.filesComplete !== true)
		throw new Error("PR changed-file coverage is incomplete or unverified");
	return details.files.map((file) => file.path);
}
