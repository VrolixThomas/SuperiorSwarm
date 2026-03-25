export function SolvingBanner() {
	return (
		<div className="flex items-center gap-2 border-b border-[var(--accent)] bg-[rgba(10,132,255,0.08)] px-3 py-1.5">
			<div
				className="h-3 w-3 shrink-0 rounded-full border-[1.5px] border-[var(--border-subtle)] border-t-[var(--accent)]"
				style={{ animation: "spin 0.8s linear infinite" }}
			/>
			<span className="text-[10px] text-[var(--accent)]">
				AI is solving comments — check the AI Solver terminal tab
			</span>
			<style>{"@keyframes spin { to { transform: rotate(360deg); } }"}</style>
		</div>
	);
}
