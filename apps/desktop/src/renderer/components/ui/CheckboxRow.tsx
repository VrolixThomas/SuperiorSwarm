import type { ReactNode } from "react";

interface CheckboxRowProps {
	checked: boolean;
	onClick: () => void;
	label: ReactNode;
	icon?: ReactNode;
	meta?: ReactNode;
}

export function CheckboxRow({ checked, onClick, label, icon, meta }: CheckboxRowProps) {
	return (
		<button
			type="button"
			// biome-ignore lint/a11y/useSemanticElements: checkbox button intentional for compound interaction
			role="checkbox"
			aria-checked={checked}
			onClick={onClick}
			className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)]"
		>
			<span
				aria-hidden="true"
				className={`flex h-3.5 w-3.5 items-center justify-center rounded-[3px] border text-[8px] ${
					checked
						? "border-[var(--accent)] bg-[var(--accent)] text-white"
						: "border-[var(--border-active)]"
				}`}
			>
				{checked && "✓"}
			</span>
			{icon}
			<span className="flex-1 truncate">{label}</span>
			{meta != null && (
				<span className="ml-auto text-[9px] text-[var(--text-quaternary)]">{meta}</span>
			)}
		</button>
	);
}
