import type { ComponentProps } from "react";
import { useProjectStore } from "../stores/projects";
import { ProjectItem } from "./ProjectItem";

type ProjectRow = ComponentProps<typeof ProjectItem>["project"];

export function FolderList({ items }: { items: ProjectRow[] }) {
	const { expandedProjectIds, toggleProjectExpanded } = useProjectStore();
	return (
		<div className="flex flex-col gap-2">
			{items.map((project) => (
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
