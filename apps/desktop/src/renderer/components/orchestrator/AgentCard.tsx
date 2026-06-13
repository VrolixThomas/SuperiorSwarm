import { useState } from "react";
import type { WorkspacePhase } from "../../../shared/control-plane";
import { formatRelativeTime } from "../../../shared/tickets";
import { StatusPill } from "./StatusPill";

export interface AgentCardData {
	workspaceId: string;
	branch: string;
	phase: WorkspacePhase;
	statusText: string | null;
	needs: string | null;
	worktreePath: string | null;
	statusUpdatedAt: string | null;
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
	const [expanded, setExpanded] = useState(false);
	const blocked = data.phase === "blocked";
	const relTime = formatRelativeTime(data.statusUpdatedAt ?? undefined);
	// Measure the text actually shown (blocked cards render `needs`), and treat
	// multi-line content as long too, so the 4-line clamp always has an escape.
	const shown = blocked && data.needs ? data.needs : data.statusText;
	const isLong = (shown?.length ?? 0) > 140 || (shown?.split("\n").length ?? 0) > 4;

	return (
		<div
			className="rounded-[8px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-[11px_12px]"
			style={blocked ? { borderColor: "rgba(230,162,60,0.35)" } : undefined}
		>
			<div className="flex items-center gap-[7px]">
				<span className="flex-1 truncate font-mono text-[12px] text-[var(--text-secondary)]">
					{data.branch}
				</span>
				{relTime && (
					<span className="shrink-0 text-[10.5px] text-[var(--text-quaternary)]">{relTime}</span>
				)}
				<StatusPill phase={data.phase} />
			</div>

			{shown && (
				<div
					className={[
						"mt-[8px] whitespace-pre-wrap text-[12px] leading-[1.5] text-[var(--text-tertiary)]",
						expanded
							? "max-h-[240px] overflow-y-auto"
							: "overflow-hidden [-webkit-box-orient:vertical] [-webkit-line-clamp:4] [display:-webkit-box]",
					].join(" ")}
				>
					{blocked && data.needs ? (
						<>
							Needs input: <b className="font-semibold text-[var(--st-blocked)]">{data.needs}</b>
						</>
					) : (
						data.statusText
					)}
				</div>
			)}

			{isLong && (
				<button
					type="button"
					onClick={() => setExpanded((v) => !v)}
					className="mt-[5px] text-[11px] font-medium text-[var(--accent)] hover:text-[var(--accent-hover)]"
				>
					{expanded ? "Show less" : "Show more"}
				</button>
			)}

			<div className="mt-[10px] flex items-center gap-[8px]">
				<button
					type="button"
					onClick={onOpen}
					className="inline-flex h-[26px] items-center gap-[5px] rounded-[7px] border border-[var(--border)] bg-[var(--bg-surface)] px-[10px] text-[11.5px] font-medium text-[var(--text-secondary)] hover:border-[var(--border-active)] hover:text-[var(--text)]"
				>
					Open terminal →
				</button>
				{blocked && (
					<button
						type="button"
						onClick={onAnswer}
						className="ml-auto inline-flex h-[26px] items-center rounded-[7px] border border-[rgba(230,162,60,0.35)] bg-[var(--st-blocked-bg)] px-[10px] text-[11.5px] font-semibold text-[var(--st-blocked)] hover:bg-[rgba(230,162,60,0.22)]"
					>
						Answer
					</button>
				)}
			</div>
		</div>
	);
}
