import { Toggle } from "./Toggle";

export function ToggleRow({
	label,
	description,
	checked,
	onChange,
}: {
	label: string;
	description: string;
	checked: boolean;
	onChange: () => void;
}) {
	return (
		<div className="flex items-center justify-between px-4 py-3.5">
			<div className="flex flex-col gap-0.5">
				<span className="text-[13px] font-medium text-[var(--text)]">{label}</span>
				<span className="text-[12px] text-[var(--text-tertiary)]">{description}</span>
			</div>
			<Toggle checked={checked} onChange={onChange} />
		</div>
	);
}
