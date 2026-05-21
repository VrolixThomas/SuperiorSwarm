import type { ProjectWorkspaceTree, WorkspaceTreeRow } from "../../shared/types";

export function flattenWorkspaceTree(tree: ProjectWorkspaceTree): WorkspaceTreeRow[] {
	return [
		...tree.orchestrators.map((o) => o.workspace),
		...tree.orchestrators.flatMap((o) => o.children),
		...tree.loose,
	];
}
