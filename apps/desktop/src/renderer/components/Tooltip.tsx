import { type ReactNode, useRef, useState } from "react";
import { createPortal } from "react-dom";

export function Tooltip({
	label,
	children,
}: {
	label: string;
	children: ReactNode;
}) {
	const triggerRef = useRef<HTMLSpanElement>(null);
	const [visible, setVisible] = useState(false);
	const [pos, setPos] = useState({ x: 0, y: 0 });

	const show = () => {
		if (!triggerRef.current) return;
		const rect = triggerRef.current.getBoundingClientRect();
		setPos({ x: rect.left + rect.width / 2, y: rect.bottom + 6 });
		setVisible(true);
	};

	const hide = () => setVisible(false);

	return (
		<span
			ref={triggerRef}
			className="inline-flex"
			onMouseEnter={show}
			onMouseLeave={hide}
		>
			{children}
			{visible &&
				createPortal(
					<span
						className="pointer-events-none fixed z-50 -translate-x-1/2 whitespace-nowrap rounded-[var(--radius-sm)] bg-[var(--bg-overlay)] px-2 py-1 text-[11px] text-[var(--text-secondary)] shadow-lg"
						style={{ left: pos.x, top: pos.y }}
					>
						{label}
					</span>,
					document.body
				)}
		</span>
	);
}
