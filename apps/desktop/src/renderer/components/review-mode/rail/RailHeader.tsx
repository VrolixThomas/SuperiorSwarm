import { useState } from "react";
import type { ReviewPathSource } from "../../../lib/review-path-source";
import { Bot, LoaderCircle, MoreHorizontal } from "./RailIcons";

export function RailHeader({
	mode,
	onModeChange,
	source,
	progress,
	showViewed = true,
	showAgentControls = true,
}: {
	mode: "path" | "files";
	onModeChange: (mode: "path" | "files") => void;
	source: ReviewPathSource;
	progress: { viewed: number; total: number };
	showViewed?: boolean;
	showAgentControls?: boolean;
}) {
	const [menuOpen, setMenuOpen] = useState(false);
	const { path, status } = source;
	return (
		<div className="relative shrink-0 border-b border-[var(--border-subtle)] py-3 pl-4 pr-3.5">
			<div className="flex items-center justify-between gap-2">
				<div className="flex rounded-[6px] bg-[var(--bg-base)] p-0.5">
					{(["path", "files"] as const).map((value) => (
						<button
							key={value}
							type="button"
							aria-pressed={mode === value}
							disabled={
								!showAgentControls &&
								value === "path" &&
								(status === "none" || (status === "failed" && !path?.entries.length))
							}
							title={
								value === "path" && status === "none"
									? "Start an agent review to create a reading path"
									: undefined
							}
							onClick={() => onModeChange(value)}
							className={`h-6 rounded-[5px] px-3 text-[12px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40 ${mode === value ? "bg-[var(--bg-overlay)] text-[var(--text)]" : "text-[var(--text-secondary)]"}`}
						>
							{value === "path" ? (showAgentControls ? "Path" : "Reading path") : "Files"}
						</button>
					))}
				</div>
				{showAgentControls &&
					(status === "mapping" ? (
						<button
							type="button"
							onClick={source.stop}
							className="rounded-[6px] border border-[var(--border)] px-2 py-0.5 text-[12px] text-[var(--text-secondary)]"
						>
							Stop
						</button>
					) : (
						path && (
							<button
								type="button"
								aria-label="Path options"
								aria-expanded={menuOpen}
								onClick={() => setMenuOpen(!menuOpen)}
								className="flex h-6 w-6 items-center justify-center rounded-[6px] text-[var(--text-tertiary)]"
							>
								<MoreHorizontal size={16} />
							</button>
						)
					))}
			</div>
			{menuOpen && (
				<div className="absolute right-3 top-10 z-10 rounded-[6px] border border-[var(--border)] bg-[var(--bg-elevated)] p-1 shadow-[var(--shadow-lg)]">
					<button
						type="button"
						disabled={!source.available}
						title={source.unavailableReason}
						onClick={() => {
							setMenuOpen(false);
							source.retry();
						}}
						className="rounded px-3 py-1 text-[12px] text-[var(--text)] disabled:opacity-50"
					>
						Re-map
					</button>
				</div>
			)}
			<div className="mt-2 flex min-w-0 items-center gap-1.5 text-[12px] text-[var(--text-tertiary)]">
				{showAgentControls && status === "mapping" ? (
					<>
						<LoaderCircle
							size={12}
							className="shrink-0 motion-safe:animate-spin"
							aria-hidden="true"
						/>
						<span className="truncate">
							{path?.agent.label} is reading{" "}
							<span className="font-mono text-[11px]">
								{path?.progress?.currentFile?.split("/").pop() ?? "the PR"}
							</span>
						</span>
					</>
				) : mode === "files" ? (
					<span>
						{progress.total} changed · {path ? "folder order" : "alphabetical"}
					</span>
				) : path ? (
					<>
						<Bot size={12} className="shrink-0" aria-hidden="true" />
						<span className="truncate">
							{path.agent.label} ·{" "}
							{path.reviewed
								? `reviewed, ${path.reviewed.findings} findings`
								: `${path.entries.length} entry points`}
						</span>
					</>
				) : (
					<span>No reading path yet</span>
				)}
			</div>
			{showAgentControls && status === "stale" && (
				<div className="mt-2 text-[11px] text-[var(--text-secondary)]">
					Path is from an older commit ·{" "}
					<button
						type="button"
						disabled={!source.available}
						title={source.unavailableReason}
						onClick={source.retry}
						className="text-[var(--accent-hover)] disabled:opacity-50"
					>
						Re-map
					</button>
				</div>
			)}
			{showViewed && (
				<div className="mt-2.5 flex items-center gap-2.5">
					<div
						aria-hidden="true"
						className="h-[3px] flex-1 overflow-hidden rounded bg-[var(--bg-overlay)]"
					>
						<div
							className="h-full rounded bg-[var(--color-success)]"
							style={{ width: `${progress.total ? (progress.viewed / progress.total) * 100 : 0}%` }}
						/>
					</div>
					<span className="whitespace-nowrap text-[11px] text-[var(--text-secondary)]">
						{progress.viewed} of {progress.total} viewed
					</span>
				</div>
			)}
		</div>
	);
}
