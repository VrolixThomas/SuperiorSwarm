import { useProjectStore } from "../stores/projects";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";
import { ProjectItem } from "./ProjectItem";

export function ProjectList() {
	const { data: projectsList } = trpc.projects.list.useQuery();
	const { expandedProjectIds, toggleProjectExpanded } = useProjectStore();
	const activeWorkspaceId = useTabStore((s) => s.activeWorkspaceId);

	if (!projectsList?.length) return null;

	return (
		<div className="flex flex-col gap-2 px-2 pt-2">
			{projectsList.map((project) => (
				<ProjectItem
					key={project.id}
					project={project}
					isExpanded={expandedProjectIds.has(project.id)}
					onToggle={() => toggleProjectExpanded(project.id)}
					activeWorkspaceId={activeWorkspaceId}
				/>
			))}
		</div>
	);
}
