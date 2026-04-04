import { useBranchStore } from "../stores/branch-store";
import { trpc } from "../trpc/client";

export function BranchChip({ projectId }: { projectId: string }) {
	const openPalette = useBranchStore((s) => s.openPalette);

	const statusQuery = trpc.branches.getStatus.useQuery({ projectId }, { refetchInterval: 10_000 });

	const status = statusQuery.data;
	const isConflict = status?.state === "merging" || status?.state === "rebasing";

	return (
		<button
			type="button"
			onClick={openPalette}
			className={[
				"flex items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-1 text-[12px] transition-all duration-[var(--transition-fast)]",
				isConflict
					? status?.state === "merging"
						? "border border-[rgba(255,69,58,0.3)] bg-[rgba(255,69,58,0.05)]"
						: "border border-[rgba(255,159,10,0.3)] bg-[rgba(255,159,10,0.05)]"
					: "border border-[var(--border)] bg-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.08)]",
			].join(" ")}
		>
			{isConflict ? (
				<svg
					aria-hidden="true"
					width="12"
					height="12"
					viewBox="0 0 24 24"
					fill="none"
					stroke={status?.state === "merging" ? "#ff453a" : "#ff9f0a"}
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
							? "text-[#ff453a]"
							: "text-[#ff9f0a]"
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
				<span className="rounded-full bg-[rgba(48,209,88,0.1)] px-1.5 text-[10px] text-[#30d158]">
					↑{status.ahead}
				</span>
			)}
			{!isConflict && status && status.behind > 0 && (
				<span className="rounded-full bg-[rgba(255,159,10,0.1)] px-1.5 text-[10px] text-[#ff9f0a]">
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
