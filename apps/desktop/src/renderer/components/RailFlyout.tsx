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
	// Position flyout so its top aligns with the anchor icon,
	// clamped to stay within the viewport.
	const flyoutMaxHeight = window.innerHeight - 80;
	const top = Math.max(8, Math.min(anchorRect.top, window.innerHeight - flyoutMaxHeight - 8));

	return createPortal(
		<div
			className="rail-flyout fixed z-50 flex flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-elevated)] shadow-[var(--shadow-lg)]"
			style={{
				top,
				left: railWidth + 4,
				width: 260,
				maxHeight: flyoutMaxHeight,
			}}
			onMouseEnter={onMouseEnter}
			onMouseLeave={onMouseLeave}
		>
			<div className="flex-1 overflow-y-auto">{children}</div>
		</div>,
		document.body
	);
}
