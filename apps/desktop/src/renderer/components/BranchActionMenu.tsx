import { useEffect, useRef, useState } from "react";
import { trpc } from "../trpc/client";

interface Props {
	projectId: string;
	branch: string;
	currentBranch: string;
	position: { x: number; y: number };
	onClose: () => void;
	onMerge: (branch: string) => void;
	onRebase: (ontoBranch: string) => void;
	isMerging?: boolean;
}

export function BranchActionMenu({
	projectId,
	branch,
	currentBranch,
	position,
	onClose,
	onMerge,
	onRebase,
	isMerging,
}: Props) {
	const menuRef = useRef<HTMLDivElement>(null);
	const renameInputRef = useRef<HTMLInputElement>(null);
	const [adjusted, setAdjusted] = useState(position);
	const [deleteConfirm, setDeleteConfirm] = useState(false);
	const [renaming, setRenaming] = useState(false);
	const [renameValue, setRenameValue] = useState(branch);

	const utils = trpc.useUtils();
	const isCurrentBranch = branch === currentBranch;

	const deleteMutation = trpc.branches.delete.useMutation({
		onSuccess: () => {
			utils.branches.list.invalidate({ projectId });
			onClose();
		},
	});

	const renameMutation = trpc.branches.rename.useMutation({
		onSuccess: () => {
			utils.branches.list.invalidate({ projectId });
			onClose();
		},
	});

	const pushMutation = trpc.remote.push.useMutation({
		onSuccess: () => {
			onClose();
		},
	});

	// Viewport clamping
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
		} else {
			setAdjusted(position);
		}
	}, [position]);

	// Focus rename input when entering rename mode
	useEffect(() => {
		if (renaming && renameInputRef.current) {
			renameInputRef.current.focus();
			renameInputRef.current.select();
		}
	}, [renaming]);

	// Click outside → close
	useEffect(() => {
		function handleClickOutside(e: MouseEvent) {
			if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
				onClose();
			}
		}
		document.addEventListener("mousedown", handleClickOutside);
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, [onClose]);

	// Escape → close
	useEffect(() => {
		function handleKeyDown(e: KeyboardEvent) {
			if (e.key === "Escape") {
				if (renaming) {
					setRenaming(false);
					setRenameValue(branch);
				} else {
					onClose();
				}
			}
		}
		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [onClose, renaming, branch]);

	function handleMerge() {
		onMerge(branch);
		onClose();
	}

	function handleRebase() {
		onRebase(branch);
		onClose();
	}

	function handlePush() {
		pushMutation.mutate({ projectId, branch });
	}

	function handleDeleteClick() {
		if (!deleteConfirm) {
			setDeleteConfirm(true);
			return;
		}
		deleteMutation.mutate({ projectId, branch, force: false });
	}

	function handleRenameSubmit() {
		const trimmed = renameValue.trim();
		if (trimmed && trimmed !== branch) {
			renameMutation.mutate({ projectId, oldName: branch, newName: trimmed });
		} else {
			setRenaming(false);
			onClose();
		}
	}

	const itemClass =
		"flex w-full items-center px-3 py-1.5 text-left text-[13px] text-[var(--text-secondary)] transition-all duration-[120ms] hover:bg-[var(--bg-overlay)] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed";

	const dangerClass =
		"flex w-full items-center px-3 py-1.5 text-left text-[13px] transition-all duration-[120ms] hover:bg-[var(--bg-overlay)] cursor-pointer";

	const separator = <div className="my-0.5 border-t border-[var(--border-subtle)]" />;

	// Rename mode: replace menu content with an inline input
	if (renaming) {
		return (
			<div
				ref={menuRef}
				className="fixed z-[60] min-w-[200px] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)] p-2 shadow-[var(--shadow-md)]"
				style={{ left: adjusted.x, top: adjusted.y }}
			>
				<div className="mb-1 px-1 text-[11px] text-[var(--text-tertiary)]">Rename branch</div>
				<input
					ref={renameInputRef}
					type="text"
					value={renameValue}
					onChange={(e) => setRenameValue(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							e.preventDefault();
							handleRenameSubmit();
						}
					}}
					className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-overlay)] px-2 py-1 text-[13px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
				/>
				<div className="mt-2 flex gap-1.5">
					<button
						type="button"
						onClick={handleRenameSubmit}
						disabled={renameMutation.isPending}
						className="flex-1 rounded-[var(--radius-sm)] bg-[var(--accent)] px-2 py-1 text-[12px] text-white transition-opacity hover:opacity-80 disabled:opacity-40"
					>
						{renameMutation.isPending ? "Renaming…" : "Rename"}
					</button>
					<button
						type="button"
						onClick={() => {
							setRenaming(false);
							setRenameValue(branch);
						}}
						className="flex-1 rounded-[var(--radius-sm)] border border-[var(--border)] px-2 py-1 text-[12px] text-[var(--text-secondary)] transition-all hover:bg-[var(--bg-overlay)]"
					>
						Cancel
					</button>
				</div>
			</div>
		);
	}

	return (
		<div
			ref={menuRef}
			role="menu"
			className="fixed z-[60] min-w-[200px] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)] py-1 shadow-[var(--shadow-md)]"
			style={{ left: adjusted.x, top: adjusted.y }}
		>
			<div className="px-3 pb-1 pt-0.5 text-[11px] text-[var(--text-tertiary)]">
				<span className="font-mono">{branch}</span>
			</div>
			{separator}

			{/* Merge — hidden for current branch */}
			{!isCurrentBranch && (
				<>
					<button
						type="button"
						role="menuitem"
						className={itemClass}
						onClick={handleMerge}
						disabled={isMerging}
					>
						Merge &lsquo;{branch}&rsquo; into current
					</button>
					<button
						type="button"
						role="menuitem"
						className={itemClass}
						onClick={handleRebase}
						disabled={isMerging}
					>
						Rebase current onto &lsquo;{branch}&rsquo;
					</button>
				</>
			)}

			{separator}

			{/* Push */}
			<button
				type="button"
				role="menuitem"
				className={itemClass}
				onClick={handlePush}
				disabled={pushMutation.isPending}
			>
				{pushMutation.isPending ? "Pushing…" : "Push"}
			</button>

			{/* Rename */}
			<button type="button" role="menuitem" className={itemClass} onClick={() => setRenaming(true)}>
				Rename…
			</button>

			{separator}

			{/* Delete with inline confirmation */}
			{deleteConfirm ? (
				<div className="px-3 py-1.5">
					<div className="mb-1.5 text-[12px] text-[var(--text-secondary)]">
						Delete &lsquo;{branch}&rsquo;?
					</div>
					<div className="flex gap-1.5">
						<button
							type="button"
							onClick={handleDeleteClick}
							disabled={deleteMutation.isPending}
							className="flex-1 rounded-[var(--radius-sm)] bg-[var(--color-danger)] px-2 py-0.5 text-[12px] text-white transition-opacity hover:opacity-80 disabled:opacity-40"
						>
							{deleteMutation.isPending ? "Deleting…" : "Delete"}
						</button>
						<button
							type="button"
							onClick={() => setDeleteConfirm(false)}
							className="flex-1 rounded-[var(--radius-sm)] border border-[var(--border)] px-2 py-0.5 text-[12px] text-[var(--text-secondary)] transition-all hover:bg-[var(--bg-overlay)]"
						>
							Cancel
						</button>
					</div>
				</div>
			) : (
				<button
					type="button"
					role="menuitem"
					className={`${dangerClass} text-[var(--color-danger)]`}
					onClick={handleDeleteClick}
				>
					Delete
				</button>
			)}
		</div>
	);
}
