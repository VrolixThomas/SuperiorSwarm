export function AboutSettings() {
	return (
		<div>
			<h1 className="text-[20px] font-semibold text-[var(--text)]">About</h1>
			<p className="mb-8 mt-1 text-[13px] text-[var(--text-tertiary)]">BranchFlux</p>

			<div className="overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--bg-surface)]">
				<div className="flex items-center justify-between px-4 py-3.5">
					<div className="flex flex-col gap-0.5">
						<span className="text-[13px] font-medium text-[var(--text)]">Version</span>
						<span className="text-[12px] text-[var(--text-tertiary)]">0.1.0</span>
					</div>
				</div>
			</div>
		</div>
	);
}
