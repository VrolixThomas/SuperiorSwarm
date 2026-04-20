import {
	type HTMLAttributes,
	type ReactNode,
	useCallback,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { useClickOutside } from "../../hooks/useClickOutside";
import { useEscapeKey } from "../../hooks/useEscapeKey";

interface PopoverProps extends Omit<HTMLAttributes<HTMLDivElement>, "style"> {
	position: { x: number; y: number };
	onClose: () => void;
	children: ReactNode;
	viewportMargin?: number;
}

export function Popover({
	position,
	onClose,
	children,
	className = "",
	viewportMargin = 8,
	...rest
}: PopoverProps) {
	const ref = useRef<HTMLDivElement>(null);
	const [adjusted, setAdjusted] = useState(position);

	// Stabilize onClose so useClickOutside / useEscapeKey don't re-attach listeners
	// whenever a parent passes an inline arrow function as onClose.
	const onCloseRef = useRef(onClose);
	onCloseRef.current = onClose;
	const stableClose = useCallback(() => onCloseRef.current(), []);

	useClickOutside(ref, stableClose);
	useEscapeKey(stableClose);

	const { x: px, y: py } = position;
	useLayoutEffect(() => {
		if (!ref.current) return;
		const rect = ref.current.getBoundingClientRect();
		let nx = px;
		let ny = py;
		if (nx + rect.width > window.innerWidth - viewportMargin) {
			nx = Math.max(viewportMargin, window.innerWidth - rect.width - viewportMargin);
		}
		if (ny + rect.height > window.innerHeight - viewportMargin) {
			ny = Math.max(viewportMargin, window.innerHeight - rect.height - viewportMargin);
		}
		setAdjusted((prev) => (prev.x === nx && prev.y === ny ? prev : { x: nx, y: ny }));
	}, [px, py, viewportMargin]);

	return (
		<div
			ref={ref}
			className={`fixed z-50 rounded-[8px] border border-[var(--border)] bg-[var(--bg-overlay)] shadow-xl ${className}`}
			style={{ left: adjusted.x, top: adjusted.y }}
			{...rest}
		>
			{children}
		</div>
	);
}
