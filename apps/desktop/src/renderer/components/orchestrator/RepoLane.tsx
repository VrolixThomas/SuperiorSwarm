import type { AgentCardData } from "./AgentCard";
import { AgentCard } from "./AgentCard";

export function RepoLane({
	repoName,
	role,
	cards,
	onAnswer,
	onOpen,
	onUnlink,
}: {
	repoName: string;
	role: "backend" | "frontend" | null;
	cards: AgentCardData[];
	onAnswer: (workspaceId: string) => void;
	onOpen: (workspaceId: string) => void;
	onUnlink: () => void;
}) {
	return (
		<section className="group/repo rounded-[10px] border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
			<div className="flex items-center gap-[8px] border-b border-[var(--border-subtle)] p-[11px_12px]">
				<span className="font-mono text-[12.5px] font-semibold text-[var(--text)]">{repoName}</span>
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
				<span className="text-[11px] text-[var(--text-quaternary)] tabular-nums">
					{cards.length} {cards.length === 1 ? "agent" : "agents"}
				</span>
				<button
					type="button"
					onClick={onUnlink}
					aria-label={`Unlink ${repoName}`}
					title="Unlink repo"
					className="ml-auto px-[4px] text-[14px] leading-none text-[var(--text-quaternary)] opacity-0 transition-opacity hover:text-[var(--text)] focus:opacity-100 group-hover/repo:opacity-100"
				>
					×
				</button>
			</div>
			<div className="p-[10px]">
				{cards.length === 0 ? (
					<div className="px-[2px] py-[4px] text-[11.5px] italic text-[var(--text-quaternary)]">
						No agents yet — dispatch a task to start one here
					</div>
				) : (
					<div className="flex flex-wrap gap-[8px]">
						{cards.map((c) => (
							<div key={c.workspaceId} className="min-w-0 grow basis-[340px]">
								<AgentCard
									data={c}
									onAnswer={() => onAnswer(c.workspaceId)}
									onOpen={() => onOpen(c.workspaceId)}
								/>
							</div>
						))}
					</div>
				)}
			</div>
		</section>
	);
}
