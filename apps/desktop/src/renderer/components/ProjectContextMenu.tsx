import { useEffect, useRef, useState } from "react";
import { trpc } from "../trpc/client";

const COLORS = [
	"#0a84ff",
	"#30d158",
	"#ff9f0a",
	"#ff375f",
	"#bf5af2",
	"#64d2ff",
	"#ffd60a",
	"#ff6482",
];

interface ProjectContextMenuProps {
	project: { id: string; name: string; color: string | null };
	position: { x: number; y: number };
	onClose: () => void;
}

export function ProjectContextMenu({ project, position, onClose }: ProjectContextMenuProps) {
	const menuRef = useRef<HTMLDivElement>(null);
	const [showColors, setShowColors] = useState(false);
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

	function handleColorChange(color: string) {
		updateMutation.mutate({ id: project.id, color });
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
			<div
				role="menuitem"
				tabIndex={0}
				className={itemClass}
				onClick={() => setShowColors(!showColors)}
				onKeyDown={(e) => {
					if (e.key === "Enter") setShowColors(!showColors);
				}}
			>
				Change Color
			</div>
			{showColors && (
				<div className="flex flex-wrap gap-1.5 px-3 py-2">
					{COLORS.map((color) => (
						<button
							key={color}
							type="button"
							aria-label={`Set color ${color}`}
							className="size-4 shrink-0 rounded-full transition-all duration-[120ms] hover:scale-125"
							style={{
								backgroundColor: color,
								outline: project.color === color ? "2px solid var(--text)" : "none",
								outlineOffset: 1,
							}}
							onClick={() => handleColorChange(color)}
						/>
					))}
				</div>
			)}
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
