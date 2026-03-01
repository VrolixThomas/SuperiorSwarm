import { useState } from "react";
import type { Project } from "../../main/db/schema";
import { useProjectStore } from "../stores/projects";
import { trpc } from "../trpc/client";
import { ProjectContextMenu } from "./ProjectContextMenu";
import { WorkspaceItem } from "./WorkspaceItem";

interface ProjectItemProps {
	project: Project;
	isExpanded: boolean;
	onToggle: () => void;
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
	return (
		<svg
			aria-hidden="true"
			width="8"
			height="8"
			viewBox="0 0 8 8"
			fill="none"
			className={[
				"shrink-0 transition-transform duration-[120ms]",
				expanded ? "rotate-90" : "rotate-0",
			].join(" ")}
		>
			<path
				d="M2 1l3 3-3 3"
				stroke="currentColor"
				strokeWidth="1.3"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

export function ProjectItem({ project, isExpanded, onToggle }: ProjectItemProps) {
	const isCloning = project.status === "cloning";
	const isReady = project.status === "ready";
	const isError = project.status === "error";

	// Poll clone progress when cloning
	const { data: progress } = trpc.projects.cloneProgress.useQuery(
		{ id: project.id },
		{ enabled: isCloning, refetchInterval: 1000 }
	);

	// Poll project status to detect when clone completes
	const utils = trpc.useUtils();
	trpc.projects.getById.useQuery(
		{ id: project.id },
		{
			enabled: isCloning,
			refetchInterval: 2000,
			select: (data) => {
				if (data && data.status !== "cloning") {
					utils.projects.list.invalidate();
				}
				return data;
			},
		}
	);

	// Fetch workspaces when expanded and project is ready
	const { data: workspacesList } = trpc.workspaces.listByProject.useQuery(
		{ projectId: project.id },
		{ enabled: isExpanded && isReady }
	);

	const openCreateWorktreeModal = useProjectStore((s) => s.openCreateWorktreeModal);

	const [contextMenu, setContextMenu] = useState<{
		x: number;
		y: number;
	} | null>(null);

	return (
		<>
			<button
				type="button"
				onClick={isReady ? onToggle : undefined}
				onContextMenu={(e) => {
					e.preventDefault();
					setContextMenu({ x: e.clientX, y: e.clientY });
				}}
				className={[
					"flex w-full items-center gap-2 border-none px-3 py-1.5 rounded-[6px] cursor-pointer",
					"transition-all duration-[120ms] text-left",
					isExpanded
						? "bg-[var(--bg-elevated)] text-[var(--text)]"
						: "bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]",
				].join(" ")}
			>
				{/* Chevron */}
				<ChevronIcon expanded={isExpanded} />

				{/* Color dot */}
				<div
					className="size-2 shrink-0 rounded-full"
					style={{
						backgroundColor: isError
							? "var(--term-red)"
							: (project.color ?? "var(--text-quaternary)"),
					}}
				/>

				{/* Name and status */}
				<div className="min-w-0 flex-1">
					<div className={["truncate text-[13px]", isCloning ? "opacity-60" : ""].join(" ")}>
						{project.name}
					</div>
					{isCloning && (
						<div className="text-[11px] text-[var(--text-quaternary)]">
							{progress ? `${progress.stage}... ${progress.progress}%` : "Cloning..."}
						</div>
					)}
				</div>
			</button>

			{/* Expanded workspace list */}
			{isExpanded && isReady && workspacesList && (
				<div className="flex flex-col gap-0.5 pt-0.5">
					{workspacesList.map((ws) => (
						<WorkspaceItem
							key={ws.id}
							workspace={ws}
							projectName={project.name}
							projectRepoPath={project.repoPath}
						/>
					))}

					{/* New Worktree button */}
					<button
						type="button"
						onClick={() => openCreateWorktreeModal(project.id)}
						className={[
							"flex w-full items-center gap-1.5 border-none pl-7 pr-3 py-1 rounded-[6px] cursor-pointer",
							"bg-transparent text-[11px] text-[var(--text-tertiary)]",
							"transition-all duration-[120ms]",
							"hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)]",
						].join(" ")}
					>
						<svg
							aria-hidden="true"
							width="10"
							height="10"
							viewBox="0 0 16 16"
							fill="none"
							className="shrink-0"
						>
							<path
								d="M8 3v10M3 8h10"
								stroke="currentColor"
								strokeWidth="1.5"
								strokeLinecap="round"
							/>
						</svg>
						New Worktree
					</button>
				</div>
			)}

			{contextMenu && (
				<ProjectContextMenu
					project={project}
					position={contextMenu}
					onClose={() => setContextMenu(null)}
				/>
			)}
		</>
	);
}
