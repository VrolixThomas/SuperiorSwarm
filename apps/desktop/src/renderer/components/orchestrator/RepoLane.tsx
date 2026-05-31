import type { AgentCardData } from "./AgentCard";
import { AgentCard } from "./AgentCard";

export function RepoLane({
	repoName,
	role,
	cards,
	onAnswer,
	onOpen,
	onDispatchHere,
}: {
	repoName: string;
	role: "backend" | "frontend" | null;
	cards: AgentCardData[];
	onAnswer: (workspaceId: string) => void;
	onOpen: (workspaceId: string) => void;
	onDispatchHere: () => void;
}) {
	return (
		<section className="flex min-h-[220px] flex-col rounded-[10px] border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
			<div className="flex items-center gap-[8px] border-b border-[var(--border-subtle)] p-[11px_12px]">
				<span className="flex-1 font-mono text-[12.5px] font-semibold text-[var(--text)]">
					{repoName}
				</span>
				{role && (
					<span
						className="rounded-[5px] px-[6px] py-[1px] text-[10px] font-semibold"
						style={
							role === "backend"
								? { color: "var(--orch-2)", background: "rgba(176,154,138,0.13)" }
								: { color: "var(--orch-3)", background: "rgba(154,176,138,0.13)" }
						}
					>
						{role.toUpperCase()}
					</span>
				)}
			</div>
			<div className="flex flex-1 flex-col gap-[8px] p-[9px]">
				{cards.length === 0 ? (
					<div className="px-[2px] py-[6px] text-[11.5px] italic text-[var(--text-quaternary)]">
						No agents in this repo yet
					</div>
				) : (
					cards.map((c) => (
						<AgentCard
							key={c.workspaceId}
							data={c}
							onAnswer={() => onAnswer(c.workspaceId)}
							onOpen={() => onOpen(c.workspaceId)}
						/>
					))
				)}
			</div>
			<button
				type="button"
				onClick={onDispatchHere}
				className="m-[0_9px_10px] flex h-[30px] items-center justify-center gap-[6px] rounded-[8px] border border-dashed border-[var(--border)] text-[11.5px] text-[var(--text-quaternary)] hover:border-[var(--border-active)] hover:text-[var(--text-tertiary)]"
			>
				+ dispatch agent here
			</button>
		</section>
	);
}
