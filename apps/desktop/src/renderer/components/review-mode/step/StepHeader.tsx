import { type ReactNode, useState } from "react";
import type { StepTest } from "../../../../shared/review-path-types";
import { Bot, ChevronRight, FlaskConical } from "../rail/RailIcons";

export interface StepHeaderProps {
	filePath: string;
	label: string;
	additions?: number;
	deletions?: number;
	viewed?: boolean;
	viewedPending?: boolean;
	onViewedChange?: (viewed: boolean) => void;
	onPrevious?: () => void;
	onNext?: () => void;
	note?: string;
	alsoIn?: string[];
	detail?: string;
	tests?: StepTest[];
	onOpenFile?: (path: string) => void;
	context?: boolean;
	action?: ReactNode;
}
const navClass =
	"flex size-6 shrink-0 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-overlay)] disabled:opacity-40";
export function StepHeader({
	filePath,
	label,
	additions,
	deletions,
	viewed,
	viewedPending,
	onViewedChange,
	onPrevious,
	onNext,
	note,
	alsoIn,
	detail,
	tests,
	onOpenFile,
	context,
	action,
}: StepHeaderProps) {
	const [expandedPath, setExpandedPath] = useState<string | null>(null);
	const expanded = expandedPath === filePath;
	const slash = filePath.lastIndexOf("/") + 1;
	return (
		<header className="shrink-0 border-b border-[var(--border-subtle)] px-6 py-3">
			<div className="flex min-w-0 items-center gap-2.5">
				<button
					type="button"
					aria-label="Previous file"
					disabled={!onPrevious}
					onClick={onPrevious}
					className={navClass}
				>
					<ChevronRight size={12} className="rotate-180" />
				</button>
				<button
					type="button"
					aria-label="Next file"
					disabled={!onNext}
					onClick={onNext}
					className={navClass}
				>
					<ChevronRight size={12} />
				</button>
				<span className="shrink-0 text-[12px] text-[var(--text-tertiary)]">{label}</span>
				<span title={filePath} className="min-w-0 truncate font-mono text-[12px]">
					<span className="text-[var(--text-tertiary)]">{filePath.slice(0, slash)}</span>
					<span className="font-medium text-[var(--text)]">{filePath.slice(slash)}</span>
				</span>
				{context ? (
					<span className="shrink-0 rounded border border-[var(--tag-gray-border)] px-2 py-0.5 text-[11px] text-[var(--tag-gray-fg)]">
						Not changed in this PR
					</span>
				) : (
					additions !== undefined && (
						<span className="shrink-0 font-mono text-[11px]">
							<span className="text-[var(--color-success)]">+{additions}</span>{" "}
							<span className="text-[var(--color-danger)]">−{deletions ?? 0}</span>
						</span>
					)
				)}
				<div className="flex-1" />
				{action}
				{!context && onViewedChange && (
					<label className="flex shrink-0 cursor-pointer items-center gap-2 text-[12px] text-[var(--text)]">
						<input
							type="checkbox"
							checked={viewed ?? false}
							disabled={viewedPending}
							onChange={(event) => onViewedChange(event.target.checked)}
							className="size-3.5 accent-[var(--accent)]"
						/>
						Viewed
						<kbd className="rounded bg-[var(--bg-elevated)] px-1.5 text-[11px] text-[var(--text-secondary)]">
							v
						</kbd>
					</label>
				)}
			</div>
			{(note || (tests?.length ?? 0) > 0) && (
				<div className="mt-2.5 flex items-start gap-2.5">
					{note && (
						<>
							<span
								aria-hidden="true"
								className="flex size-5 shrink-0 items-center justify-center rounded-md bg-[var(--bg-overlay)] text-[var(--text-secondary)]"
							>
								<Bot size={12} />
							</span>
							<p className="min-w-0 flex-1 text-[13px] text-[var(--text)]">
								{note}
								{detail && (
									<button
										type="button"
										aria-expanded={expanded}
										onClick={() => setExpandedPath(expanded ? null : filePath)}
										className="ml-1 text-[12px] text-[var(--accent-hover)]"
									>
										{expanded ? "less" : "more"}
									</button>
								)}
							</p>
						</>
					)}
					{!!tests?.length && (
						<div className="ml-auto flex max-w-[40%] flex-wrap items-center gap-1.5 text-[11px] text-[var(--text-tertiary)]">
							<FlaskConical size={12} />
							Tested by{" "}
							{tests.map((test) => (
								<button
									key={test.path}
									type="button"
									title={test.path}
									disabled={!onOpenFile}
									onClick={() => onOpenFile?.(test.path)}
									className="truncate font-mono text-[var(--accent-hover)]"
								>
									{test.path.split("/").pop()}
								</button>
							))}
						</div>
					)}
				</div>
			)}
			{expanded && detail && (
				<p className="mt-2 max-h-24 overflow-y-auto pl-[30px] text-[12px] leading-5 text-[var(--text-secondary)]">
					{detail}
				</p>
			)}
			{alsoIn && alsoIn.length > 0 && (
				<p className="mt-1 text-[11px] text-[var(--text-tertiary)]">
					Also used in {alsoIn.join(", ")}
				</p>
			)}
		</header>
	);
}
