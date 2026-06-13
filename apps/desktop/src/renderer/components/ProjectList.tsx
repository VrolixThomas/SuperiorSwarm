import { useProjectStore } from "../stores/projects";
import { trpc } from "../trpc/client";
import { ProjectItem } from "./ProjectItem";
import { SidebarSectionHeader } from "./SidebarSectionHeader";

export function ProjectList() {
	const { data: projectsList } = trpc.projects.list.useQuery();
	const { expandedProjectIds, toggleProjectExpanded, openAddModal } = useProjectStore();

	return (
		<div className="flex flex-col px-2 pb-2">
			<SidebarSectionHeader
				title="Repositories"
				count={projectsList?.length}
				onNew={openAddModal}
				newLabel="Add Repository"
				className="sticky top-0 z-10 -mx-2 bg-[var(--bg-surface)]"
			/>
			<div className="flex flex-col gap-2">
				{(projectsList ?? []).map((project) => (
					<ProjectItem
						key={project.id}
						project={project}
						isExpanded={expandedProjectIds.has(project.id)}
						onToggle={() => toggleProjectExpanded(project.id)}
					/>
				))}
			</div>
		</div>
	);
}
