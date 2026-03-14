import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

interface PaneContextMenuProps {
	x: number;
	y: number;
	onSplitRight: () => void;
	onSplitDown: () => void;
	onClosePane?: () => void;
	onClose: () => void;
}

function MenuItem({
	label,
	icon,
	onClick,
	variant = "default",
}: {
	label: string;
	icon: React.ReactNode;
	onClick: () => void;
	variant?: "default" | "danger";
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={`flex w-full items-center gap-2 rounded-[4px] border-none bg-transparent px-2 py-[5px] text-left text-[12px] transition-colors duration-[80ms] ${
				variant === "danger"
					? "text-[var(--term-red)] hover:bg-[rgba(255,107,107,0.1)]"
					: "text-[var(--text-secondary)] hover:bg-[rgba(255,255,255,0.08)] hover:text-[var(--text)]"
			}`}
		>
			<span className="flex h-[16px] w-[16px] shrink-0 items-center justify-center text-[var(--text-quaternary)]">
				{icon}
			</span>
			{label}
		</button>
	);
}

export function PaneContextMenu({
	x,
	y,
	onSplitRight,
	onSplitDown,
	onClosePane,
	onClose,
}: PaneContextMenuProps) {
	const menuRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		function handleClickOutside(e: MouseEvent) {
			if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
				onClose();
			}
		}
		function handleKeyDown(e: KeyboardEvent) {
			if (e.key === "Escape") {
				onClose();
			}
		}
		// Use capture so the click doesn't propagate to other handlers first
		document.addEventListener("mousedown", handleClickOutside, true);
		document.addEventListener("keydown", handleKeyDown);
		return () => {
			document.removeEventListener("mousedown", handleClickOutside, true);
			document.removeEventListener("keydown", handleKeyDown);
		};
	}, [onClose]);

	// Clamp position so menu doesn't overflow the viewport
	const menuWidth = 180;
	const menuHeight = onClosePane ? 120 : 80;
	const clampedX = Math.min(x, window.innerWidth - menuWidth - 8);
	const clampedY = Math.min(y, window.innerHeight - menuHeight - 8);

	return createPortal(
		<div
			ref={menuRef}
			className="fixed z-[9999] min-w-[170px] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)] p-1 shadow-[var(--shadow-lg)]"
			style={{ top: clampedY, left: clampedX }}
			onContextMenu={(e) => e.preventDefault()}
		>
			<MenuItem
				label="Split Right"
				onClick={() => {
					onSplitRight();
					onClose();
				}}
				icon={
					<svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none">
						<rect
							x="1.5"
							y="2.5"
							width="13"
							height="11"
							rx="1.5"
							stroke="currentColor"
							strokeWidth="1.2"
						/>
						<line x1="8" y1="2.5" x2="8" y2="13.5" stroke="currentColor" strokeWidth="1.2" />
					</svg>
				}
			/>
			<MenuItem
				label="Split Down"
				onClick={() => {
					onSplitDown();
					onClose();
				}}
				icon={
					<svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none">
						<rect
							x="1.5"
							y="2.5"
							width="13"
							height="11"
							rx="1.5"
							stroke="currentColor"
							strokeWidth="1.2"
						/>
						<line x1="1.5" y1="8" x2="14.5" y2="8" stroke="currentColor" strokeWidth="1.2" />
					</svg>
				}
			/>
			{onClosePane && (
				<>
					<div className="mx-1 my-1 h-px bg-[var(--border)]" />
					<MenuItem
						label="Close Pane"
						variant="danger"
						onClick={() => {
							onClosePane();
							onClose();
						}}
						icon={
							<svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none">
								<path
									d="M4 4l8 8M12 4l-8 8"
									stroke="currentColor"
									strokeWidth="1.3"
									strokeLinecap="round"
								/>
							</svg>
						}
					/>
				</>
			)}
		</div>,
		document.body
	);
}
