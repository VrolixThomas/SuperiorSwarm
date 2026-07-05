import type { UnifiedThread } from "../../../../shared/github-types";
import { type ThreadBucket, threadBucket } from "../../../lib/pr-review-threads";

const CHIP: Record<ThreadBucket, { label: string; className: string }> = {
	pending: {
		label: "Pending",
		className: "bg-[var(--purple-subtle)] text-[var(--color-purple)]",
	},
	accepted: {
		label: "Accepted",
		className: "bg-[var(--success-subtle)] text-[var(--color-success)]",
	},
	declined: {
		label: "Declined",
		className: "bg-[var(--danger-subtle)] text-[var(--color-danger)]",
	},
	open: {
		label: "Open",
		className: "bg-[var(--warning-subtle)] text-[var(--color-warning)]",
	},
	resolved: {
		label: "Resolved",
		className: "bg-[var(--success-subtle)] text-[var(--color-success)]",
	},
};

export function ThreadStatusChip({ thread }: { thread: UnifiedThread }) {
	if (thread.isAIDraft && thread.status === "error") {
		return (
			<span className="rounded-[4px] bg-[var(--danger-subtle)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--color-danger)]">
				Failed
			</span>
		);
	}

	const chip = CHIP[threadBucket(thread)];

	return (
		<span className={`rounded-[4px] px-1.5 py-0.5 text-[11px] font-medium ${chip.className}`}>
			{chip.label}
		</span>
	);
}
