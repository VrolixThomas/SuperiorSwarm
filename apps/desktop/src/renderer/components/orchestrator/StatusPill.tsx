import type { WorkspacePhase } from "../../../shared/control-plane";

const LABEL: Record<WorkspacePhase, string> = {
	idle: "Queued",
	working: "Working",
	blocked: "Blocked",
	done: "Done",
};

export function StatusPill({ phase }: { phase: WorkspacePhase }) {
	return (
		<span
			className="inline-flex items-center gap-[5px] rounded-[9px] px-[7px] py-[2px] text-[10.5px] font-semibold leading-none"
			style={{ color: `var(--st-${phase})`, background: `var(--st-${phase}-bg)` }}
		>
			{phase === "working" && (
				<span
					className="h-[6px] w-[6px] rounded-full"
					style={{ background: `var(--st-${phase})` }}
				/>
			)}
			{LABEL[phase]}
		</span>
	);
}
