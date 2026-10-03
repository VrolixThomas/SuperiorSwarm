export function Toggle({
	checked,
	onChange,
	disabled = false,
	label,
	describedBy,
}: {
	checked: boolean;
	onChange: () => void;
	disabled?: boolean;
	label?: string;
	describedBy?: string;
}) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			aria-label={label}
			aria-describedby={describedBy}
			disabled={disabled}
			onClick={onChange}
			className={`relative h-[22px] w-[40px] shrink-0 cursor-pointer rounded-full border-none transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
				checked ? "bg-[var(--accent)]" : "bg-[var(--bg-overlay)]"
			}`}
		>
			<div
				className={`absolute top-[2px] size-[18px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.18)] transition-transform ${
					checked ? "translate-x-[20px]" : "translate-x-[2px]"
				}`}
			/>
		</button>
	);
}
