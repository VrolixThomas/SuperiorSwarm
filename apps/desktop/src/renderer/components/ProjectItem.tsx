import { useState } from "react";
import type { Project } from "../../main/db/schema";
import { trpc } from "../trpc/client";
import { ProjectContextMenu } from "./ProjectContextMenu";

interface ProjectItemProps {
	project: Project;
	isSelected: boolean;
	onSelect: () => void;
}

export function ProjectItem({ project, isSelected, onSelect }: ProjectItemProps) {
	const isCloning = project.status === "cloning";
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
	const [contextMenu, setContextMenu] = useState<{
		x: number;
		y: number;
	} | null>(null);

	return (
		<>
			<button
				type="button"
				onClick={onSelect}
				onContextMenu={(e) => {
					e.preventDefault();
					setContextMenu({ x: e.clientX, y: e.clientY });
				}}
				className={[
					"flex w-full items-center gap-2 border-none px-3 py-1.5 rounded-[6px] cursor-pointer",
					"transition-all duration-[120ms] text-left",
					isSelected
						? "bg-[var(--bg-elevated)] text-[var(--text)]"
						: "bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]",
				].join(" ")}
			>
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
