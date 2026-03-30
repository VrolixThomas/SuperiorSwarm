import { useEffect, useRef, useState } from "react";
import { useProjectStore } from "../stores/projects";
import { trpc } from "../trpc/client";

interface ProjectContextMenuProps {
	project: { id: string; name: string; color: string | null };
	position: { x: number; y: number };
	onClose: () => void;
}

export function ProjectContextMenu({ project, position, onClose }: ProjectContextMenuProps) {
	const menuRef = useRef<HTMLDivElement>(null);
	const [adjusted, setAdjusted] = useState(position);
	const utils = trpc.useUtils();

	const updateMutation = trpc.projects.update.useMutation({
		onSuccess: () => {
			utils.projects.list.invalidate();
		},
	});

	const deleteMutation = trpc.projects.delete.useMutation({
		onSuccess: () => {
			utils.projects.list.invalidate();
		},
	});

	// Adjust position to avoid going off-screen
	useEffect(() => {
		if (!menuRef.current) return;
		const rect = menuRef.current.getBoundingClientRect();
		let { x, y } = position;

		if (x + rect.width > window.innerWidth) {
			x = window.innerWidth - rect.width - 8;
		}
		if (y + rect.height > window.innerHeight) {
			y = window.innerHeight - rect.height - 8;
		}

		if (x !== position.x || y !== position.y) {
			setAdjusted({ x, y });
		}
	}, [position]);

	// Close on click outside
	useEffect(() => {
		function handleClickOutside(e: MouseEvent) {
			if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
				onClose();
			}
		}
		document.addEventListener("mousedown", handleClickOutside);
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, [onClose]);

	// Close on Escape
	useEffect(() => {
		function handleKeyDown(e: KeyboardEvent) {
			if (e.key === "Escape") {
				onClose();
			}
		}
		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [onClose]);

	function handleRename() {
		const newName = window.prompt("Rename project:", project.name);
		if (newName && newName !== project.name) {
			updateMutation.mutate({ id: project.id, name: newName });
		}
		onClose();
	}

	function handleSharedFiles() {
		useProjectStore.getState().openSharedFilesPanel(project.id);
		onClose();
	}

	function handleRemove() {
		const confirmed = window.confirm("Remove project? This won't delete files.");
		if (confirmed) {
			deleteMutation.mutate({ id: project.id });
		}
		onClose();
	}

	const itemClass = [
		"px-3 py-1.5 text-[13px] cursor-pointer",
		"hover:bg-[var(--bg-overlay)] transition-all duration-[120ms]",
		"text-[var(--text-secondary)]",
	].join(" ");

	const dangerItemClass = [
		"px-3 py-1.5 text-[13px] cursor-pointer",
		"hover:bg-[var(--bg-overlay)] transition-all duration-[120ms]",
		"text-[var(--term-red)]",
	].join(" ");

	return (
		<div
			ref={menuRef}
			className="fixed z-50 min-w-[160px] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)] py-1 shadow-[var(--shadow-md)]"
			style={{ left: adjusted.x, top: adjusted.y }}
		>
			<div
				role="menuitem"
				tabIndex={0}
				className={itemClass}
				onClick={handleRename}
				onKeyDown={(e) => {
					if (e.key === "Enter") handleRename();
				}}
			>
				Rename
			</div>
			<div className="my-0.5 border-t border-[var(--border-subtle)]" />
			<div
				role="menuitem"
				tabIndex={0}
				className={itemClass}
				onClick={handleSharedFiles}
				onKeyDown={(e) => {
					if (e.key === "Enter") handleSharedFiles();
				}}
			>
				Shared Files
			</div>
			<div className="my-0.5 border-t border-[var(--border-subtle)]" />
			<div
				role="menuitem"
				tabIndex={0}
				className={dangerItemClass}
				onClick={handleRemove}
				onKeyDown={(e) => {
					if (e.key === "Enter") handleRemove();
				}}
			>
				Remove
			</div>
		</div>
	);
}
