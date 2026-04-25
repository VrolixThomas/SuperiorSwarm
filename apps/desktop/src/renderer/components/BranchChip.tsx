import { useBranchStore } from "../stores/branch-store";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";

export function BranchChip({ projectId }: { projectId: string }) {
	const openPalette = useBranchStore((s) => s.openPalette);
	const cwd = useTabStore((s) => s.activeWorkspaceCwd);

	const statusQuery = trpc.branches.getStatus.useQuery(
		{ projectId, cwd: cwd || undefined },
		{ refetchInterval: 2_000 }
	);

	const status = statusQuery.data;
	const isConflict = status?.state === "merging" || status?.state === "rebasing";

	function handleClick() {
		if (isConflict) {
			// Focus the merge-conflict tab if one exists
			const tabStore = useTabStore.getState();
			const mergeTab = tabStore.getAllTabs().find((t) => t.kind === "merge-conflict");
			if (mergeTab) {
				tabStore.setActiveTab(mergeTab.id);
				return;
			}
		}
		openPalette();
	}

	return (
		<button
			type="button"
			onClick={handleClick}
			className={[
				"app-no-drag flex items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-1 text-[12px] transition-all duration-[var(--transition-fast)]",
				isConflict
					? status?.state === "merging"
						? "border border-[rgba(255,69,58,0.3)] bg-[rgba(255,69,58,0.05)]"
						: "border border-[rgba(255,159,10,0.3)] bg-[rgba(255,159,10,0.05)]"
					: "border border-[var(--border)] bg-[var(--bg-overlay)] hover:bg-[var(--bg-active)]",
			].join(" ")}
		>
			{isConflict ? (
				<svg
					aria-hidden="true"
					width="12"
					height="12"
					viewBox="0 0 24 24"
					fill="none"
					stroke={status?.state === "merging" ? "var(--color-danger)" : "var(--color-warning)"}
					strokeWidth="2"
				>
					<circle cx="12" cy="12" r="10" />
					<path d="M12 8v4" />
					<path d="M12 16h.01" />
				</svg>
			) : (
				<svg
					aria-hidden="true"
					width="12"
					height="12"
					viewBox="0 0 24 24"
					fill="none"
					stroke="var(--text-secondary)"
					strokeWidth="2"
				>
					<path d="M6 3v12" />
					<circle cx="18" cy="6" r="3" />
					<circle cx="6" cy="18" r="3" />
					<path d="M18 9a9 9 0 0 1-9 9" />
				</svg>
			)}

			<span
				className={[
					"max-w-[180px] truncate font-medium",
					isConflict
						? status?.state === "merging"
							? "text-[var(--color-danger)]"
							: "text-[var(--color-warning)]"
						: "text-[var(--text)]",
				].join(" ")}
			>
				{isConflict
					? status?.state === "merging"
						? "MERGING"
						: "REBASING"
					: (status?.branch ?? "...")}
			</span>

			{!isConflict && status && status.ahead > 0 && (
				<span className="rounded-full bg-[rgba(48,209,88,0.1)] px-1.5 text-[10px] text-[var(--color-success)]">
					↑{status.ahead}
				</span>
			)}
			{!isConflict && status && status.behind > 0 && (
				<span className="rounded-full bg-[rgba(255,159,10,0.1)] px-1.5 text-[10px] text-[var(--color-warning)]">
					↓{status.behind}
				</span>
			)}

			<svg
				aria-hidden="true"
				width="8"
				height="8"
				viewBox="0 0 24 24"
				fill="none"
				stroke="var(--text-quaternary)"
				strokeWidth="2.5"
			>
				<path d="m6 9 6 6 6-6" />
			</svg>
		</button>
	);
}
