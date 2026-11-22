import type { ReviewAgentJob } from "../../../../shared/review-agent-job";
import type { ReviewPath } from "../../../../shared/review-path-types";
import { MarkdownRenderer } from "../../MarkdownRenderer";
export interface PathSummaryCardProps {
	path: ReviewPath;
	headSha?: string;
	job?: ReviewAgentJob;
	findingsCount: number;
	onRead: () => void;
	onFindings: () => void;
	onBrowse: () => void;
	onRemap?: () => void;
	onOpenSession?: () => void;
	description?: string;
}
export function PathSummaryCard({
	path,
	headSha,
	job,
	findingsCount,
	onRead,
	onFindings,
	onBrowse,
	onRemap,
	onOpenSession,
	description,
}: PathSummaryCardProps) {
	const provenance =
		job?.kind === "mapping" && job.state === "completed" && job.identity.headSha === path.headSha
			? job
			: undefined;
	const start = provenance?.startedAt ? new Date(provenance.startedAt) : null;
	const end = provenance?.endedAt ? new Date(provenance.endedAt) : null;
	const elapsed =
		start && end && Number.isFinite(+start) && Number.isFinite(+end)
			? `${Math.max(0, Math.round((+end - +start) / 1000))}s`
			: "—";
	const rows = [
		[
			"Started",
			start && Number.isFinite(+start)
				? `${provenance?.trigger === "auto" ? "Automatically" : "Manually"} · ${start.toLocaleString()}`
				: "—",
		],
		["Agent", `${path.agent.label} · ${elapsed}`],
		[
			"Revision",
			`${path.headSha.slice(0, 8)} · ${headSha ? (path.headSha === headSha ? "Latest revision" : "Older revision") : "—"}`,
		],
		["Route", path.entries.map((entry) => entry.title).join(" · ") || "—"],
		["Other files", `${path.otherFiles.length} changed files outside the path`],
	];
	return (
		<section aria-label="Path summary" className="mx-auto w-full max-w-[760px] px-6 py-8">
			<p className="mb-2 text-[12px] text-[var(--text-tertiary)]">Agent reading path</p>
			<h1 className="text-[24px] font-semibold tracking-tight">How this path was made</h1>
			<p className="mt-2 text-[13px] text-[var(--text-secondary)]">
				Follow each entry point through its changes and tests. You can read all changed files at any
				time.
			</p>
			<dl className="my-6 divide-y divide-[var(--border-subtle)] rounded-[10px] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4">
				{rows.map(([label, value]) => (
					<div key={label} className="grid grid-cols-[90px_minmax(0,1fr)] gap-4 py-3 text-[12px]">
						<dt className="text-[var(--text-tertiary)]">{label}</dt>
						<dd className="break-words text-[var(--text-secondary)]">{value}</dd>
					</div>
				))}
				<div className="grid grid-cols-[90px_minmax(0,1fr)] gap-4 py-3 text-[12px]">
					<dt className="text-[var(--text-tertiary)]">Agent review</dt>
					<dd>
						<button
							type="button"
							disabled={!findingsCount}
							onClick={onFindings}
							className="text-[var(--accent-hover)] disabled:text-[var(--text-tertiary)]"
						>
							{findingsCount
								? `${findingsCount} findings · Review findings →`
								: path.reviewed
									? "No findings"
									: "—"}
						</button>
					</dd>
				</div>
			</dl>
			<div className="flex flex-wrap gap-3">
				<button
					type="button"
					onClick={onRead}
					className="rounded-md bg-[var(--accent)] px-4 py-2 text-[13px] text-[var(--accent-foreground)]"
				>
					Read the path →
				</button>
				<button
					type="button"
					onClick={onBrowse}
					className="rounded-md border border-[var(--border)] px-4 py-2 text-[13px]"
				>
					Browse files
				</button>
				{onRemap && (
					<button
						type="button"
						onClick={onRemap}
						className="rounded-md border border-[var(--border)] px-4 py-2 text-[13px]"
					>
						Re-map path
					</button>
				)}
				{onOpenSession && (
					<button
						type="button"
						onClick={onOpenSession}
						className="rounded-md px-2 py-2 text-[13px] text-[var(--accent-hover)]"
					>
						Open session →
					</button>
				)}
			</div>
			{description && (
				<div className="mt-8 border-t border-[var(--border-subtle)] pt-6">
					<h2 className="mb-3 text-[14px] font-semibold">PR description</h2>
					<MarkdownRenderer content={description} />
				</div>
			)}
		</section>
	);
}
