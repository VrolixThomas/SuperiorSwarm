import { useEffect } from "react";
import { trpc } from "../trpc/client";

interface ContextMenuAction {
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
}

export function QuickActionContextMenu({
	action,
	x,
	y,
	onClose,
	onEdit,
}: QuickActionContextMenuProps) {
	const utils = trpc.useUtils();
	const deleteMutation = trpc.quickActions.delete.useMutation({
		onSuccess: () => utils.quickActions.list.invalidate(),
	});

	useEffect(() => {
		function handleClickOutside() {
			onClose();
		}
		document.addEventListener("click", handleClickOutside);
		return () => document.removeEventListener("click", handleClickOutside);
	}, [onClose]);

	return (
		<div
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
