import type { WorkspacePhase } from "../../../shared/control-plane";
import { StatusPill } from "./StatusPill";

export interface AgentCardData {
	workspaceId: string;
	branch: string;
	phase: WorkspacePhase;
	statusText: string | null;
	needs: string | null;
}

export function AgentCard({
	data,
	onAnswer,
	onOpen,
}: {
	data: AgentCardData;
	onAnswer: () => void;
	onOpen: () => void;
}) {
	const blocked = data.phase === "blocked";
	return (
		<button
			type="button"
			onClick={onOpen}
			className="block w-full rounded-[8px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-[10px_11px] text-left transition-colors hover:border-[var(--border-active)]"
			style={blocked ? { borderColor: "rgba(230,162,60,0.35)" } : undefined}
		>
			<div className="flex items-center gap-[7px]">
				<span className="flex-1 truncate font-mono text-[11.5px] text-[var(--text-secondary)]">
					{data.branch}
				</span>
				<StatusPill phase={data.phase} />
			</div>
			{data.statusText && (
				<div className="mt-[7px] text-[12px] text-[var(--text-tertiary)]">
					{blocked && data.needs ? (
						<>
							Needs input: <b className="font-semibold text-[var(--st-blocked)]">{data.needs}</b>
						</>
					) : (
						data.statusText
					)}
				</div>
			)}
			{blocked && (
				<div className="mt-[9px] flex justify-end">
					{/* biome-ignore lint/a11y/useSemanticElements: cannot nest <button> inside <button> */}
					{/* biome-ignore lint/a11y/useKeyWithClickEvents: keyboard events handled via outer button */}
					<span
						role="button"
						tabIndex={0}
						onClick={(e) => {
							e.stopPropagation();
							onAnswer();
						}}
						onKeyDown={(e) => {
							if (e.key === "Enter" || e.key === " ") {
								e.stopPropagation();
								onAnswer();
							}
						}}
						className="text-[11px] font-medium text-[var(--accent)]"
					>
						Answer →
					</span>
				</div>
			)}
		</button>
	);
}
