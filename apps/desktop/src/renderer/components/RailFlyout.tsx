import { createPortal } from "react-dom";

interface RailFlyoutProps {
	anchorRect: DOMRect;
	railWidth: number;
	children: React.ReactNode;
	onMouseEnter: () => void;
	onMouseLeave: () => void;
}

export function RailFlyout({
	anchorRect,
	railWidth,
	children,
	onMouseEnter,
	onMouseLeave,
}: RailFlyoutProps) {
	// Position flyout so its top aligns with the anchor element.
	// If the content would overflow the bottom, shift upward (but never above margin).
	const margin = 8;
	const preferredMaxHeight = 500;
	const maxHeight = Math.min(preferredMaxHeight, window.innerHeight - margin * 2);
	const spaceBelow = window.innerHeight - anchorRect.top - margin;

	let top: number;
	if (spaceBelow >= maxHeight) {
		// Enough room below the anchor — align top edges
		top = anchorRect.top;
	} else {
		// Not enough room — push upward, clamped to top margin
		top = Math.max(margin, window.innerHeight - margin - maxHeight);
	}

	return createPortal(
		<div
			className="rail-flyout fixed z-50 flex flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-elevated)] shadow-[var(--shadow-lg)]"
			style={{
				top,
				left: railWidth + 4,
				width: 260,
				maxHeight,
			}}
			onMouseEnter={onMouseEnter}
			onMouseLeave={onMouseLeave}
		>
			<div className="flex-1 overflow-y-auto">{children}</div>
		</div>,
		document.body
	);
}
