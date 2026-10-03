/** Explicit browser bounds, matching the product's worktree watcher exclusions. */
export const FILE_BROWSER_EXCLUDED_DIRECTORIES = new Set([
	".git",
	"node_modules",
	"dist",
	"out",
	"build",
	".next",
	".cache",
	"~",
	".turbo",
	"target",
	"coverage",
	"graphify-out",
]);

export function isExcludedBrowserEntry(name: string, isDirectory: boolean): boolean {
	return (
		name === ".git" ||
		(isDirectory
			? FILE_BROWSER_EXCLUDED_DIRECTORIES.has(name)
			: name === ".DS_Store" || name === "Thumbs.db")
	);
}
