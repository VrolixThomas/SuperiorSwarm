export function PageHeading({ title, subtitle }: { title: string; subtitle: string }) {
	return (
		<>
			<h1 className="text-[20px] font-semibold text-[var(--text)]">{title}</h1>
			<p className="mb-8 mt-1 text-[13px] text-[var(--text-tertiary)]">{subtitle}</p>
		</>
	);
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
	return (
		<div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.05em] text-[var(--text-quaternary)]">
			{children}
		</div>
	);
}
