import { useLayoutEffect, useRef, useState } from "react";
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
	const maxHeight = Math.min(500, window.innerHeight - margin * 2);
	const ref = useRef<HTMLDivElement>(null);
	const [measuredHeight, setMeasuredHeight] = useState<number | null>(null);

	// Measure actual rendered height so positioning uses real content size.
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when children change
	useLayoutEffect(() => {
		if (ref.current) {
			setMeasuredHeight(ref.current.scrollHeight);
		}
	}, [children]);

	// Use measured height for positioning, fall back to maxHeight on first render
	const effectiveHeight = Math.min(measuredHeight ?? maxHeight, maxHeight);

	// Align flyout top with the anchor top.
	// If that would overflow the bottom, shift up just enough to fit.
	const idealTop = anchorRect.top;
	const overflow = idealTop + effectiveHeight - (window.innerHeight - margin);
	const top = Math.max(margin, overflow > 0 ? idealTop - overflow : idealTop);

	return createPortal(
		<div
			ref={ref}
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
