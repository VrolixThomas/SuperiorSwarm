/**
 * Resolve the working directory for a workspace.
 * Precedence: git worktree path > folder workspace cwd override > project path.
 */
export function resolveWorkspaceCwd(opts: {
	worktreePath: string | null;
	folderPath: string | null;
	repoPath: string;
}): string {
	return opts.worktreePath ?? opts.folderPath ?? opts.repoPath;
}
