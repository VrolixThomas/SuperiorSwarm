import type { SolveGroupInfo } from "../../../shared/solve-types";

interface Props {
	group: SolveGroupInfo;
	onApprove: () => void;
	onRevoke: () => void;
	onPush: () => void;
	isPushing: boolean;
}

export function GroupAction({ group, onApprove, onRevoke, onPush, isPushing }: Props) {
	const hasDraftReplies = group.comments.some((c) => c.reply?.status === "draft");

	if (group.status === "pending") {
		return (
			<span className="flex items-center gap-[6px] text-[11.5px] text-[var(--accent)] font-medium">
				<span
					className="w-[6px] h-[6px] rounded-full bg-[var(--accent)]"
					style={{ animation: "blink 1.6s ease-in-out infinite" }}
				/>
				Solving
			</span>
		);
	}
	if (group.status === "submitted") {
		return (
			<span className="py-[3px] px-[9px] rounded-[6px] text-[11px] font-medium bg-[var(--success-subtle)] text-[var(--success)]">
				✓ Pushed
			</span>
		);
	}
	if (group.status === "approved") {
		return (
			<div className="flex items-center gap-[6px]">
				<button
					type="button"
					onClick={(e) => {
						e.stopPropagation();
						onRevoke();
					}}
					className="py-[3px] px-[9px] rounded-[6px] text-[11px] font-medium text-[var(--text-tertiary)] bg-transparent border border-[var(--border-default)] cursor-pointer"
				>
					Revoke
				</button>
				{hasDraftReplies ? (
					<span className="py-[3px] px-[9px] rounded-[6px] text-[11px] font-medium bg-[var(--accent-subtle)] text-[var(--accent)]">
						✓ Approved
					</span>
				) : (
					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation();
							onPush();
						}}
						disabled={isPushing}
						className={`py-[4px] px-[12px] rounded-[6px] text-[11.5px] font-semibold border-none ${isPushing ? "cursor-not-allowed bg-[var(--bg-active)] text-[var(--text-tertiary)]" : "cursor-pointer bg-[var(--success)] text-[var(--accent-foreground)]"}`}
					>
						{isPushing ? "Pushing…" : "Push & post"}
					</button>
				)}
			</div>
		);
	}
	if (group.status === "fixed") {
		return (
			<button
				type="button"
				onClick={(e) => {
					e.stopPropagation();
					onApprove();
				}}
				className="py-[4px] px-[12px] rounded-[6px] text-[11.5px] font-medium bg-[var(--success-subtle)] text-[var(--success)] border-none cursor-pointer"
			>
				Approve
			</button>
		);
	}
	return null;
}
