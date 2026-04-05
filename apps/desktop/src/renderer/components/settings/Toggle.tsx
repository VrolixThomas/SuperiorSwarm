export function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
	return (
		<button
			type="button"
			onClick={onChange}
			className={`relative h-[22px] w-[40px] shrink-0 cursor-pointer rounded-full border-none transition-colors ${
				checked ? "bg-[var(--accent)]" : "bg-[var(--bg-elevated)]"
			}`}
		>
			<div
				className={`absolute top-[2px] size-[18px] rounded-full bg-white transition-transform ${
					checked ? "translate-x-[20px]" : "translate-x-[2px]"
				}`}
			/>
		</button>
	);
}
