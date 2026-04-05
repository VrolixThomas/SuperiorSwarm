import { type ReactNode, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useActionStore } from "../stores/action-store";
import { ShortcutBadge } from "./ShortcutBadge";

export function Tooltip({
	label,
	actionId,
	className,
	children,
}: {
	label: string;
	actionId?: string;
	className?: string;
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

	const shortcut = actionId ? useActionStore.getState().getShortcutForId(actionId) : undefined;

	return (
		<span
			ref={triggerRef}
			className={className ? `inline-flex ${className}` : "inline-flex"}
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
						<span className="flex items-center gap-2">
							{label}
							{shortcut && <ShortcutBadge shortcut={shortcut} />}
						</span>
					</span>,
					document.body
				)}
		</span>
	);
}
