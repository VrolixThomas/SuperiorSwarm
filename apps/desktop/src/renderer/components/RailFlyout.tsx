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
	const margin = 8;
	const preferredMaxHeight = 500;
	const maxHeight = Math.min(preferredMaxHeight, window.innerHeight - margin * 2);

	// Ideal: align flyout top with the anchor top.
	// If that would overflow the bottom, shift up just enough to fit.
	// Never go above the top margin.
	const idealTop = anchorRect.top;
	const bottom = idealTop + maxHeight;
	const overflow = bottom - (window.innerHeight - margin);
	const top = Math.max(margin, overflow > 0 ? idealTop - overflow : idealTop);

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
