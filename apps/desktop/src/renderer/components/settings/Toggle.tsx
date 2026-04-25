export function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
	return (
		<button
			type="button"
			onClick={onChange}
			className={`relative h-[22px] w-[40px] shrink-0 cursor-pointer rounded-full border-none transition-colors ${
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
