import { useProjectStore } from "../stores/projects";
import { trpc } from "../trpc/client";
import { ProjectItem } from "./ProjectItem";
import { SidebarSectionHeader } from "./SidebarSectionHeader";

export function ProjectList() {
	const { data: projectsList } = trpc.projects.list.useQuery();
	const { expandedProjectIds, toggleProjectExpanded, openAddModal } = useProjectStore();

	const all = projectsList ?? [];
	const folders = all.filter((p) => p.kind === "folder");
	const repos = all.filter((p) => p.kind !== "folder");
	const hasFolders = folders.length > 0;

	const renderItems = (items: typeof all) =>
		items.map((project) => (
			<ProjectItem
				key={project.id}
				project={project}
				isExpanded={expandedProjectIds.has(project.id)}
				onToggle={() => toggleProjectExpanded(project.id)}
			/>
		));

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			{/* Folders — pinned band with its own scroll cap so a long repo list
			    never buries them. */}
			{hasFolders && (
				<div className="shrink-0 border-b border-[var(--border-subtle)] px-2 pb-2">
					<SidebarSectionHeader
						title="Folders"
						count={folders.length}
						onNew={openAddModal}
						newLabel="Add Folder"
					/>
					<div className="flex max-h-[200px] flex-col gap-2 overflow-y-auto">
						{renderItems(folders)}
					</div>
				</div>
			)}

			{/* Repositories — the bulk; takes remaining height and scrolls. */}
			<div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2">
				<SidebarSectionHeader
					title={hasFolders ? "Repositories" : "Projects"}
					count={repos.length}
					onNew={openAddModal}
					newLabel="Add Project"
					className="sticky top-0 z-10 -mx-2 bg-[var(--bg-surface)]"
				/>
				<div className="flex flex-col gap-2">{renderItems(repos)}</div>
			</div>
		</div>
	);
}
