import type { ReactNode } from "react";

export function Tooltip({
	label,
	children,
}: {
	label: string;
	children: ReactNode;
}) {
	return (
		<span className="group/tip relative inline-flex">
			{children}
			<span className="pointer-events-none absolute left-1/2 top-full z-50 mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-[var(--radius-sm)] bg-[var(--bg-overlay)] px-2 py-1 text-[11px] text-[var(--text-secondary)] opacity-0 shadow-lg transition-opacity duration-100 group-hover/tip:opacity-100">
				{label}
			</span>
		</span>
	);
}
