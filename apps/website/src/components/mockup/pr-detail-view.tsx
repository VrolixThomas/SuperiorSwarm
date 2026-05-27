export function PrDetailView() {
	return (
		<div className="flex flex-1 flex-col overflow-hidden bg-app-bg-base">
			{/* Scrollable body, max-width 800 — matches PROverviewTab */}
			<div className="flex-1 overflow-y-auto">
				<div className="mx-auto max-w-[800px] pb-10">
					<PrHeader />
					<AiSummaryCard />
					<StatusStrip />
				</div>
			</div>

			{/* Review bottom bar — Submit Review uses bg-app-success per PROverviewTab.tsx:660 */}
			<div className="flex shrink-0 items-center justify-between border-t border-app-border-subtle px-6 py-3">
				<div className="flex items-center gap-2 text-[12px] text-app-text-tertiary">
					<span className="size-1.5 rounded-full bg-app-success" />
					<span>Ready to review</span>
				</div>
				<div className="flex items-center gap-2">
					<button
						type="button"
						className="rounded-[6px] border border-app-border-subtle px-3 py-[6px] text-[12px] text-app-text-secondary transition-colors hover:bg-app-bg-elevated"
					>
						Save draft
					</button>
					<button
						type="button"
						className="rounded-[6px] bg-app-success px-4 py-[6px] text-[12px] font-semibold text-white"
					>
						Submit Review
					</button>
				</div>
			</div>
		</div>
	);
}

function PrHeader() {
	return (
		<header className="border-b border-app-border-subtle px-6 py-5">
			<h1 className="text-[18px] font-semibold leading-tight text-app-text">
				Orchestrator workspace ordering with drag-and-drop
			</h1>

			<div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-app-text-tertiary">
				<span className="font-mono">
					<span className="text-app-text-secondary">main</span>{" "}
					<span className="text-app-text-quaternary">←</span>{" "}
					<span className="text-app-text-secondary">orchestrator-ordering</span>
				</span>
				<span className="text-app-text-quaternary">·</span>
				<span>opened 2 hours ago by</span>
				<div className="flex items-center gap-1.5">
					<div className="flex size-4 items-center justify-center rounded-full bg-app-bg-overlay text-[8px] font-bold text-app-text-tertiary">
						T
					</div>
					<span className="text-app-text-secondary">ThomasV</span>
				</div>
			</div>

			<div className="mt-4 flex flex-wrap items-center gap-2">
				<Pill tone="success" label="Open" />
				<Pill tone="success" label="✓ CI passed" />
				<Pill tone="success" label="✓ Approved" />
				<Pill tone="neutral" label="6 files · +345 / −31" mono />
			</div>

			<div className="mt-4 flex items-center gap-2 text-[11px] text-app-text-tertiary">
				<span className="text-app-text-quaternary">Reviewers</span>
				<div className="flex items-center -space-x-1.5">
					{[
						{ initial: "M", decision: "approved", color: "var(--color-pr-health-success)" },
						{ initial: "K", decision: "pending", color: "var(--color-pr-health-neutral)" },
						{ initial: "A", decision: "changes", color: "var(--color-pr-health-warning)" },
					].map((r) => (
						<div
							key={r.initial}
							title={`${r.initial} · ${r.decision}`}
							className="flex size-5 items-center justify-center rounded-full bg-app-bg-elevated text-[8px] font-medium text-app-text-tertiary"
							style={{ border: `2px solid ${r.color}` }}
						>
							{r.initial}
						</div>
					))}
				</div>
			</div>
		</header>
	);
}

function Pill({
	tone,
	label,
	mono = false,
}: {
	tone: "success" | "warning" | "danger" | "accent" | "neutral";
	label: string;
	mono?: boolean;
}) {
	const toneClass = {
		success: "bg-app-success-subtle text-app-success",
		warning: "bg-app-warning-subtle text-app-warning",
		danger: "bg-app-danger-subtle text-app-danger",
		accent: "bg-app-accent-subtle text-app-accent",
		neutral: "bg-app-bg-elevated text-app-text-tertiary",
	}[tone];
	return (
		<span
			className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${toneClass} ${mono ? "font-mono" : ""}`}
		>
			{label}
		</span>
	);
}

function AiSummaryCard() {
	return (
		<section className="mx-6 mt-5 overflow-hidden rounded-[8px] border border-app-border-subtle">
			<div className="flex items-center gap-2 bg-app-bg-elevated px-4 py-2.5">
				<span className="rounded-[4px] bg-app-ai-badge-bg px-1.5 py-px text-[10px] font-semibold text-app-ai-badge-text">
					AI
				</span>
				<span className="text-[12px] font-medium text-app-text-secondary">Summary</span>
				<span className="ml-auto text-[10px] text-app-text-quaternary">generated 2m ago</span>
			</div>
			<div className="bg-app-bg-surface px-4 py-3 text-[12px] leading-relaxed text-app-text-secondary">
				Lets users drag-and-drop orchestrator groups and child worktrees in the sidebar. Adds two
				new tRPC procedures{" "}
				<code className="rounded bg-app-bg-elevated px-1 py-px font-mono text-[11px] text-app-text">
					workspaces.reorderTopLevel
				</code>{" "}
				and{" "}
				<code className="rounded bg-app-bg-elevated px-1 py-px font-mono text-[11px] text-app-text">
					workspaces.reorderChildren
				</code>
				, wires up @dnd-kit with collision detection in{" "}
				<span className="font-mono">ProjectItem.tsx</span>, and persists ordering through{" "}
				<span className="font-mono">OrchestratorGroup.tsx</span>.
			</div>
		</section>
	);
}

function StatusStrip() {
	return (
		<section className="mx-6 mt-6">
			<div className="flex items-center gap-3">
				<Pill tone="success" label="10/10 tests" />
				<Pill tone="success" label="0 conflicts" />
				<Pill tone="accent" label="4/4 review comments resolved" />
			</div>
			<div className="mt-3 h-[2px] w-full rounded-[1px] bg-app-bg-elevated">
				<div className="h-full w-full rounded-[1px] bg-app-success" />
			</div>
			<p className="mt-2 text-[10px] uppercase tracking-[0.5px] text-app-text-quaternary">
				Review progress · complete
			</p>
		</section>
	);
}
