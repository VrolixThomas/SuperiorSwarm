import type { WorkspacePhase } from "../../../shared/control-plane";

export interface ActivityEvent {
	id: string;
	who: string;
	repo: string;
	relTime: string;
	kind: WorkspacePhase | "dispatch";
	text: string;
}

const NODE: Record<ActivityEvent["kind"], string> = {
	working: "var(--st-working)",
	blocked: "var(--st-blocked)",
	done: "var(--st-done)",
	idle: "var(--st-idle)",
	dispatch: "var(--orch-1)",
};

export function CrossRepoActivityRail({ events }: { events: ActivityEvent[] }) {
	return (
		<aside className="overflow-y-auto border-l border-[var(--border-subtle)] bg-[var(--bg-surface)] p-[18px_16px_30px]">
			<h3 className="mb-[14px] text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-quaternary)]">
				Cross-repo activity
			</h3>
			<div className="relative pl-[18px] before:absolute before:bottom-[6px] before:left-[4px] before:top-[4px] before:w-px before:bg-[var(--border-subtle)] before:content-['']">
				{events.map((e) => (
					<div key={e.id} className="relative pb-[17px]">
						<span
							className="absolute left-[-18px] top-[3px] h-[9px] w-[9px] rounded-full border-2 border-[var(--bg-surface)]"
							style={{ background: NODE[e.kind] }}
						/>
						<div className="flex items-baseline gap-[7px]">
							<span className="text-[12px] font-semibold text-[var(--text-secondary)]">
								{e.who}
							</span>
							<span className="font-mono text-[10.5px] text-[var(--text-quaternary)]">
								{e.repo}
							</span>
							<span className="ml-auto text-[10.5px] text-[var(--text-quaternary)]">
								{e.relTime}
							</span>
						</div>
						<div className="mt-[2px] text-[12px] text-[var(--text-tertiary)]">{e.text}</div>
					</div>
				))}
			</div>
		</aside>
	);
}
