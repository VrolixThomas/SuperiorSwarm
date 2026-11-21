import type { UnifiedThread } from "../../../../shared/github-types";
import { partitionChangesThreads } from "../../../lib/pr-review-threads";
export function toolbarButtonClass(active = false, disabled = false): string {
	if (disabled) {
		return "rounded px-2 py-0.5 text-[11px] text-[var(--text-tertiary)] opacity-40";
	}

	return [
		"rounded px-2 py-0.5 text-[11px] transition-colors",
		active
			? "bg-[var(--bg-elevated)] text-[var(--text)] shadow-[var(--shadow-sm)]"
			: "text-[var(--text-tertiary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]",
	].join(" ");
}

export function stepThreadLayout(
	threads: UnifiedThread[],
	mode: "split" | "inline",
	visible: boolean,
	counts: { LEFT: number; RIGHT: number }
) {
	const outdated = threads.filter((t) => t.isOutdated);
	const current = threads.filter((t) => !t.isOutdated);
	return { ...partitionChangesThreads(current, mode, visible, counts), outdated };
}
