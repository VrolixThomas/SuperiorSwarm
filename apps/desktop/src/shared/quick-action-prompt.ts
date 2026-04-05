export function buildDefaultPrompt(repoPath: string): string {
	return `Explore this repository and set up quick action buttons for common workflows.

Look at package.json, Makefile, Cargo.toml, pyproject.toml, scripts/, etc. to understand the project.

Use the MCP tools:
- list_quick_actions — see what's already configured
- add_quick_action — add new buttons (label, command, scope)
- remove_quick_action — remove existing ones

Suggest actions for: build, test, lint, dev server, type-check, or anything project-specific.
Keep labels short (1-2 words). Use scope "repo" for project-specific commands.

Repository: ${repoPath}`;
}
