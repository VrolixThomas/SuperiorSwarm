import { useProjectStore } from "../stores/projects";
import { trpc } from "../trpc/client";
import { ProjectItem } from "./ProjectItem";

export function ProjectList() {
	const { data: projectsList } = trpc.projects.list.useQuery();
	const { expandedProjectIds, toggleProjectExpanded } = useProjectStore();

	if (!projectsList?.length) return null;

	return (
		<div className="flex flex-col gap-0.5 px-2">
			{projectsList.map((project) => (
				<ProjectItem
					key={project.id}
					project={project}
					isExpanded={expandedProjectIds.has(project.id)}
					onToggle={() => toggleProjectExpanded(project.id)}
				/>
			))}
		</div>
	);
}
