/**
 * Split a branch/worktree name into its path prefix (everything up to and
 * including the last "/") and the remainder. Used to render the prefix dimmer
 * than the meaningful tail in the sidebar.
 *   "feature/PI-3040-ezugi-wallet" -> { prefix: "feature/", rest: "PI-3040-ezugi-wallet" }
 *   "main"                          -> { prefix: "", rest: "main" }
 */
export function splitBranchPrefix(name: string): { prefix: string; rest: string } {
	const i = name.lastIndexOf("/");
	if (i === -1) return { prefix: "", rest: name };
	return { prefix: name.slice(0, i + 1), rest: name.slice(i + 1) };
}
