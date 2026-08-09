import {
	type KeyboardEvent,
	type MouseEvent,
	type ReactNode,
	useCallback,
	useId,
	useRef,
} from "react";
import { useClickOutside } from "../../hooks/useClickOutside";
import { useEscapeKey } from "../../hooks/useEscapeKey";

export interface OverflowPopoverProps {
	label: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	children: ReactNode;
	panelClassName?: string;
}

function HorizontalMoreIcon() {
	return (
		<svg aria-hidden="true" viewBox="0 0 18 18" className="size-[18px]" fill="currentColor">
			<circle cx="3" cy="9" r="1.5" />
			<circle cx="9" cy="9" r="1.5" />
			<circle cx="15" cy="9" r="1.5" />
		</svg>
	);
}

export function OverflowPopover({
	label,
	open,
	onOpenChange,
	children,
	panelClassName = "",
}: OverflowPopoverProps) {
	const rootRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const panelId = useId();
	const close = useCallback(() => onOpenChange(false), [onOpenChange]);
	const closeAndRestoreFocus = useCallback(() => {
		onOpenChange(false);
		triggerRef.current?.focus();
	}, [onOpenChange]);

	useClickOutside(rootRef, close, open);
	useEscapeKey(closeAndRestoreFocus, open);

	function handlePanelClick(event: MouseEvent<HTMLDialogElement>) {
		if (!rootRef.current || !rootRef.current.contains(event.target as Node)) return;
		if ((event.target as Element).closest("[data-popover-close]")) close();
	}

	function handlePanelKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
		if (event.key !== "Enter" && event.key !== " ") return;
		if ((event.target as Element).closest("[data-popover-close]")) close();
	}

	return (
		<div ref={rootRef} className="app-no-drag relative shrink-0">
			<button
				ref={triggerRef}
				type="button"
				aria-label={label}
				aria-haspopup="dialog"
				aria-expanded={open}
				aria-controls={open ? panelId : undefined}
				onClick={() => onOpenChange(!open)}
				className="app-no-drag flex size-7 shrink-0 items-center justify-center rounded-full text-[var(--text-quaternary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/50"
			>
				<HorizontalMoreIcon />
			</button>
			{open && (
				<dialog
					id={panelId}
					open
					aria-label={label}
					onClick={handlePanelClick}
					onKeyDown={handlePanelKeyDown}
					className={`m-0 ${panelClassName}`}
				>
					{children}
				</dialog>
			)}
		</div>
	);
}
