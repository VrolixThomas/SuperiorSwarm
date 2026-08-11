import {
	type MouseEvent as ReactMouseEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";

const VIEWPORT_MARGIN = 8;
const TRIGGER_GAP = 8;
const PANEL_WIDTH = 360;
const FOCUSABLE_SELECTOR = [
	"a[href]",
	"area[href]",
	"button:not([disabled])",
	'input:not([disabled]):not([type="hidden"])',
	"select:not([disabled])",
	"textarea:not([disabled])",
	'[contenteditable]:not([contenteditable="false"])',
	'[tabindex]:not([tabindex="-1"])',
].join(",");

interface OverflowPopoverPosition {
	left: number;
	top: number;
	width: number;
	maxHeight: number;
}

export interface OverflowPopoverProps {
	label: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	children: ReactNode;
	panelClassName?: string;
	panelWidth?: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

function initialOverflowPopoverPosition(panelWidth: number): OverflowPopoverPosition {
	const viewportWidth = typeof window === "undefined" ? panelWidth : window.innerWidth;
	const viewportHeight = typeof window === "undefined" ? 0 : window.innerHeight;
	return {
		left: VIEWPORT_MARGIN,
		top: VIEWPORT_MARGIN,
		width: Math.min(panelWidth, Math.max(0, viewportWidth - VIEWPORT_MARGIN * 2)),
		maxHeight: Math.max(0, viewportHeight - VIEWPORT_MARGIN * 2),
	};
}

function focusableElements(panel: HTMLDialogElement): HTMLElement[] {
	return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
		(element) =>
			element.tabIndex >= 0 &&
			element.getAttribute("aria-disabled") !== "true" &&
			!element.closest("[hidden], [inert]") &&
			getComputedStyle(element).display !== "none" &&
			getComputedStyle(element).visibility !== "hidden"
	);
}

function positionOverflowPopover(
	triggerRect: DOMRect,
	panelRect: DOMRect,
	panelScrollHeight: number,
	viewportWidth: number,
	viewportHeight: number,
	panelWidth: number
): OverflowPopoverPosition {
	const width = Math.min(panelWidth, Math.max(0, viewportWidth - VIEWPORT_MARGIN * 2));
	const viewportMaxHeight = Math.max(0, viewportHeight - VIEWPORT_MARGIN * 2);
	const measuredWidth = Math.min(panelRect.width || width, width);
	const maximumLeft = viewportWidth - VIEWPORT_MARGIN - measuredWidth;
	const left = clamp(triggerRect.right - measuredWidth, VIEWPORT_MARGIN, maximumLeft);

	const belowTop = triggerRect.bottom + TRIGGER_GAP;
	const availableBelow = Math.max(0, viewportHeight - VIEWPORT_MARGIN - belowTop);
	const availableAbove = Math.max(0, triggerRect.top - TRIGGER_GAP - VIEWPORT_MARGIN);
	const naturalHeight = Math.min(Math.max(panelRect.height, panelScrollHeight), viewportMaxHeight);
	const fitsBelow = naturalHeight <= availableBelow;
	const fitsAbove = naturalHeight <= availableAbove;
	const placeBelow = fitsBelow || (!fitsAbove && availableBelow >= availableAbove);
	const maxHeight = placeBelow ? availableBelow : availableAbove;
	const measuredHeight = Math.min(naturalHeight, maxHeight);
	const aboveTop = triggerRect.top - TRIGGER_GAP - measuredHeight;
	const desiredTop = placeBelow ? belowTop : aboveTop;
	const maximumTop = viewportHeight - VIEWPORT_MARGIN - measuredHeight;

	return {
		left,
		top: clamp(desiredTop, VIEWPORT_MARGIN, maximumTop),
		width,
		maxHeight,
	};
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
	panelWidth = PANEL_WIDTH,
}: OverflowPopoverProps) {
	const triggerRef = useRef<HTMLButtonElement>(null);
	const panelRef = useRef<HTMLDialogElement>(null);
	const panelId = useId();
	const [position, setPosition] = useState(() => initialOverflowPopoverPosition(panelWidth));
	const close = useCallback(() => onOpenChange(false), [onOpenChange]);
	const closeAndRestoreFocus = useCallback(() => {
		onOpenChange(false);
		triggerRef.current?.focus();
	}, [onOpenChange]);

	useLayoutEffect(() => {
		if (!open || typeof window === "undefined") return;

		function updatePosition() {
			const trigger = triggerRef.current;
			const panel = panelRef.current;
			if (!trigger || !panel) return;
			const next = positionOverflowPopover(
				trigger.getBoundingClientRect(),
				panel.getBoundingClientRect(),
				panel.scrollHeight,
				window.innerWidth,
				window.innerHeight,
				panelWidth
			);
			setPosition((current) =>
				current.left === next.left &&
				current.top === next.top &&
				current.width === next.width &&
				current.maxHeight === next.maxHeight
					? current
					: next
			);
		}

		updatePosition();
		const panel = panelRef.current;
		const firstAction = panel ? focusableElements(panel)[0] : null;
		(firstAction ?? panel)?.focus();
		const resizeObserver =
			typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updatePosition);
		if (resizeObserver && triggerRef.current && panel) {
			resizeObserver.observe(triggerRef.current);
			resizeObserver.observe(panel);
		}
		window.addEventListener("resize", updatePosition);
		window.addEventListener("scroll", updatePosition, true);
		return () => {
			resizeObserver?.disconnect();
			window.removeEventListener("resize", updatePosition);
			window.removeEventListener("scroll", updatePosition, true);
		};
	}, [open, panelWidth]);

	useEffect(() => {
		if (!open) return;

		function handleMouseDown(event: MouseEvent) {
			const target = event.target;
			if (!(target instanceof Node)) return;
			if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
			close();
		}

		function handleKeyDown(event: KeyboardEvent) {
			if (event.key === "Escape") {
				event.preventDefault();
				closeAndRestoreFocus();
				return;
			}
			if (event.key !== "Tab") return;
			const panel = panelRef.current;
			if (!panel) return;
			const actions = focusableElements(panel);
			if (actions.length === 0) {
				event.preventDefault();
				panel.focus();
				return;
			}
			const activeIndex = actions.indexOf(document.activeElement as HTMLElement);
			const atBoundary = event.shiftKey
				? activeIndex <= 0
				: activeIndex === -1 || activeIndex === actions.length - 1;
			if (!atBoundary) return;
			event.preventDefault();
			const nextAction = event.shiftKey ? actions.at(-1) : actions[0];
			nextAction?.focus();
		}

		document.addEventListener("mousedown", handleMouseDown);
		document.addEventListener("keydown", handleKeyDown);
		return () => {
			document.removeEventListener("mousedown", handleMouseDown);
			document.removeEventListener("keydown", handleKeyDown);
		};
	}, [close, closeAndRestoreFocus, open]);

	function handlePanelClick(event: ReactMouseEvent<HTMLDialogElement>) {
		const target = event.target;
		if (!(target instanceof Element) || !target.closest("[data-popover-close]")) return;
		closeAndRestoreFocus();
	}

	const panel =
		open && typeof document !== "undefined"
			? createPortal(
					// biome-ignore lint/a11y/useKeyWithClickEvents: Native action controls synthesize clicks for keyboard activation.
					<dialog
						ref={panelRef}
						id={panelId}
						open
						tabIndex={-1}
						aria-label={label}
						onClick={handlePanelClick}
						className={`app-no-drag fixed z-[100] m-0 min-w-0 overflow-x-hidden overflow-y-auto overscroll-contain ${panelClassName}`}
						style={{
							position: "fixed",
							left: position.left,
							top: position.top,
							width: position.width,
							maxWidth: `calc(100vw - ${VIEWPORT_MARGIN * 2}px)`,
							maxHeight: position.maxHeight,
							boxSizing: "border-box",
							overflowX: "hidden",
							overflowY: "auto",
						}}
					>
						{children}
					</dialog>,
					document.body
				)
			: null;

	return (
		<>
			<div className="app-no-drag shrink-0">
				<button
					ref={triggerRef}
					type="button"
					aria-label={label}
					title={label}
					aria-haspopup="dialog"
					aria-expanded={open}
					aria-controls={open ? panelId : undefined}
					onClick={() => onOpenChange(!open)}
					className="app-no-drag flex size-7 shrink-0 items-center justify-center rounded-full text-[var(--text-quaternary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/50"
				>
					<HorizontalMoreIcon />
				</button>
			</div>
			{panel}
		</>
	);
}
