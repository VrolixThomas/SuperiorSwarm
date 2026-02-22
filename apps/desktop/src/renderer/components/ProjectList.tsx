import { useProjectStore } from "../stores/projects";
import { trpc } from "../trpc/client";
import { ProjectItem } from "./ProjectItem";

export function ProjectList() {
	const { data: projectsList } = trpc.projects.list.useQuery();
	const { selectedProjectId, selectProject } = useProjectStore();

	if (!projectsList?.length) return null;

	return (
		<div className="flex flex-col gap-0.5 px-2">
			{projectsList.map((project) => (
				<ProjectItem
					key={project.id}
					project={project}
					isSelected={project.id === selectedProjectId}
					onSelect={() => selectProject(project.id)}
				/>
			))}
		</div>
	);
}
