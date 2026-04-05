import { useRef } from "react";
import { useClickOutside } from "../hooks/useClickOutside";
import { trpc } from "../trpc/client";

export interface ContextMenuAction {
	id: string;
	label: string;
	command: string;
	cwd: string | null;
	shortcut: string | null;
	projectId: string | null;
	sortOrder: number;
}

interface QuickActionContextMenuProps {
	action: ContextMenuAction;
	x: number;
	y: number;
	onClose: () => void;
	onEdit: (action: ContextMenuAction) => void;
	/** All actions in current display order, for reordering */
	allActions: ContextMenuAction[];
}

export function QuickActionContextMenu({
	action,
	x,
	y,
	onClose,
	onEdit,
	allActions,
}: QuickActionContextMenuProps) {
	const menuRef = useRef<HTMLDivElement>(null);
	const utils = trpc.useUtils();
	const deleteMutation = trpc.quickActions.delete.useMutation({
		onSuccess: () => utils.quickActions.list.invalidate(),
	});
	const reorderMutation = trpc.quickActions.reorder.useMutation({
		onSuccess: () => utils.quickActions.list.invalidate(),
	});

	useClickOutside(menuRef, onClose);

	const currentIndex = allActions.findIndex((a) => a.id === action.id);
	const canMoveLeft = currentIndex > 0;
	const canMoveRight = currentIndex < allActions.length - 1;

	function handleMove(direction: "left" | "right") {
		const ids = allActions.map((a) => a.id);
		const idx = ids.indexOf(action.id);
		if (idx === -1) return;
		const swapIdx = direction === "left" ? idx - 1 : idx + 1;
		if (swapIdx < 0 || swapIdx >= ids.length) return;
		[ids[idx], ids[swapIdx]] = [ids[swapIdx]!, ids[idx]!];
		reorderMutation.mutate({ orderedIds: ids });
		onClose();
	}

	return (
		<div
			ref={menuRef}
			className="fixed z-[60] min-w-[140px] rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] py-1 shadow-xl"
			style={{ left: x, top: y }}
		>
			<button
				type="button"
				onClick={() => {
					onEdit(action);
					onClose();
				}}
				className="w-full px-3 py-1.5 text-left text-[12px] text-[var(--text)] hover:bg-[rgba(255,255,255,0.06)]"
			>
				Edit
			</button>
			{canMoveLeft && (
				<button
					type="button"
					onClick={() => handleMove("left")}
					className="w-full px-3 py-1.5 text-left text-[12px] text-[var(--text)] hover:bg-[rgba(255,255,255,0.06)]"
				>
					Move left
				</button>
			)}
			{canMoveRight && (
				<button
					type="button"
					onClick={() => handleMove("right")}
					className="w-full px-3 py-1.5 text-left text-[12px] text-[var(--text)] hover:bg-[rgba(255,255,255,0.06)]"
				>
					Move right
				</button>
			)}
			<div className="my-1 border-t border-[var(--border-subtle)]" />
			<button
				type="button"
				onClick={() => {
					deleteMutation.mutate({ id: action.id });
					onClose();
				}}
				className="w-full px-3 py-1.5 text-left text-[12px] text-[var(--color-danger)] hover:bg-[rgba(255,255,255,0.06)]"
			>
				Delete
			</button>
		</div>
	);
}
