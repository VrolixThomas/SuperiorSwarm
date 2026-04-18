import type { ReactNode } from "react";
import { CheckboxRow } from "./CheckboxRow";

export interface MultiSelectItem {
	key: string;
	label: ReactNode;
	icon?: ReactNode;
	meta?: ReactNode;
}

interface MultiSelectListProps {
	heading?: string;
	items: MultiSelectItem[];
	isChecked: (key: string) => boolean;
	onToggle: (key: string) => void;
}

export function MultiSelectList({ heading, items, isChecked, onToggle }: MultiSelectListProps) {
	return (
		<div className="py-1">
			{heading && (
				<div className="px-2.5 py-1.5 text-[9px] font-semibold uppercase tracking-[0.5px] text-[var(--text-quaternary)]">
					{heading}
				</div>
			)}
			{items.map((item) => (
				<CheckboxRow
					key={item.key}
					checked={isChecked(item.key)}
					onClick={() => onToggle(item.key)}
					label={item.label}
					icon={item.icon}
					meta={item.meta}
				/>
			))}
		</div>
	);
}
