import type { SolveGroupInfo } from "../../shared/solve-types";

interface CommentGroupItemProps {
	group: SolveGroupInfo;
	isSelected: boolean;
	onClick: () => void;
}

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
	fixed: { bg: "#2d5a2d", text: "#6fdb6f", label: "Fixed" },
	approved: { bg: "rgba(10,132,255,0.15)", text: "#0a84ff", label: "Approved" },
	reverted: { bg: "rgba(220,50,50,0.15)", text: "#ff6b6b", label: "Reverted" },
	pending: { bg: "var(--bg-overlay)", text: "var(--text-tertiary)", label: "Pending" },
};

export function CommentGroupItem({ group, isSelected, onClick }: CommentGroupItemProps) {
	const statusStyle = STATUS_STYLES[group.status] ?? STATUS_STYLES.pending;
	const commentCount = group.comments.length;
	const shortHash = group.commitHash ? group.commitHash.slice(0, 7) : null;

	return (
		<button
			type="button"
			onClick={onClick}
			className={[
				"flex w-full flex-col gap-0.5 px-3 py-2 text-left transition-colors duration-[120ms]",
				isSelected
					? "border-l-2 border-l-[var(--accent)] bg-[var(--bg-overlay)]"
					: "border-l-2 border-l-transparent hover:bg-[var(--bg-elevated)]",
			].join(" ")}
		>
			{/* Top row: label + status badge */}
			<div className="flex items-center gap-1.5">
				<span className="min-w-0 flex-1 truncate text-[12px] text-[var(--text-secondary)]">
					{group.label}
				</span>
				<span
					className="shrink-0 rounded-[3px] px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide"
					style={{
						backgroundColor: statusStyle.bg,
						color: statusStyle.text,
					}}
				>
					{statusStyle.label}
				</span>
			</div>

			{/* Bottom row: comment count + commit hash */}
			<div className="flex items-center gap-2">
				<span className="text-[10px] text-[var(--text-quaternary)]">
					{commentCount} comment{commentCount !== 1 ? "s" : ""}
				</span>
				{shortHash && (
					<span
						className="text-[10px] text-[var(--text-quaternary)]"
						style={{ fontFamily: "var(--font-mono)" }}
					>
						{shortHash}
					</span>
				)}
			</div>
		</button>
	);
}
