import { useId, useState } from "react";
import type { ReviewPathSource } from "../../lib/review-path-source";
import { useReviewPathSettingsStore } from "../../stores/review-path-settings-store";
import { trpc } from "../../trpc/client";

export interface ReviewWorkflowBarProps {
	source: ReviewPathSource;
	compact?: boolean;
	readOnly?: boolean;
	onBrowseFiles: () => void;
	onReadPath: () => void;
	onOpenAgent?: () => void;
	onOpenFindings?: () => void;
	findingsCount: number;
}

const button =
	"rounded-[6px] px-3 py-2 text-[12px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50";
const secondary = `${button} border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-secondary)] enabled:hover:bg-[var(--bg-overlay)]`;
const primary = `${button} bg-[var(--accent)] text-[var(--accent-foreground)]`;

/** Preparation, the live session, and its recorded results are separate steps. */
export function ReviewWorkflowBar({
	source,
	compact = false,
	readOnly = false,
	onBrowseFiles,
	onReadPath,
	onOpenAgent,
	onOpenFindings,
	findingsCount,
}: ReviewWorkflowBarProps) {
	const settings = useReviewPathSettingsStore();
	const agentSettings = trpc.aiReview.getSettings.useQuery(undefined, { staleTime: 30_000 });
	const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
	const recordedAgent =
		!source.starting && (source.status === "mapping" || source.status === "ready")
			? source.path?.agent.id
			: undefined;
	const preferredAgent = recordedAgent ?? agentSettings.data?.cliPreset;
	const configuredAgent = preferredAgent === "claude-code" ? "claude" : preferredAgent;
	const agentId =
		selectedAgent ??
		(configuredAgent === "codex" || configuredAgent === "claude" ? configuredAgent : "");
	const agentLabel = agentId === "codex" ? "Codex" : agentId === "claude" ? "Claude Code" : "agent";
	const preparing =
		source.starting === true ||
		(source.status === "mapping" && source.agentSessionStarted === false);
	const running = !preparing && source.status === "mapping";
	const ready = !preparing && source.status === "ready";
	const failed = !preparing && source.status === "failed";
	const stale = !preparing && source.status === "stale";
	const busy = preparing || running;
	const disabled =
		readOnly ||
		busy ||
		!source.available ||
		!agentId ||
		agentSettings.isPending ||
		agentSettings.isError;
	const launch = () => {
		if (!disabled) source.start({ agentId, alsoReview: settings.alsoReview });
	};
	const reasonId = useId();
	const unavailable =
		!busy &&
		!readOnly &&
		(agentSettings.isPending
			? "Loading review agent settings…"
			: agentSettings.isError
				? "Review agent settings could not be loaded."
				: !agentId
					? "Choose Codex or Claude Code to start."
					: !source.available
						? "Agent review is unavailable right now."
						: undefined);
	const error = !preparing && (source.path?.error ?? source.unavailableReason);
	const title = preparing
		? `Preparing ${agentLabel} workspace`
		: running
			? "Agent session started"
			: ready
				? "Reading path ready"
				: failed
					? source.agentSessionStarted
						? "Agent review stopped"
						: "Agent did not start"
					: stale
						? "PR changed since this review"
						: readOnly
							? "This PR is closed"
							: "Choose how to review";
	const explanation = preparing
		? "The agent has not started yet. You can browse files while preparation finishes."
		: running
			? "Open the agent workspace for prompts and progress. Its reading path will appear here."
			: readOnly
				? "You can still browse the files and read existing results."
				: ready
					? findingsCount > 0
						? "Follow the suggested file order, then review the findings before submitting."
						: "Follow the suggested file order or browse on your own."
					: failed
						? "You can browse the files or try again."
						: stale
							? "Update the agent review for the current changes, or browse the files."
							: "Start an agent review for a suggested reading order. You can also browse the files yourself.";
	return (
		<section
			aria-label="Review workflow"
			className={`shrink-0 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 ${compact ? "py-2.5" : "py-4"}`}
		>
			<div className="mx-auto w-full max-w-[1480px]">
				<div className="flex flex-wrap items-start gap-x-8 gap-y-3">
					<div className="min-w-0 max-w-[620px] flex-[1_1_320px]" aria-live="polite">
						<h2 className="text-[13px] font-semibold text-[var(--text)]">{title}</h2>
						{(!compact || preparing || running || failed) && (
							<p className="mt-1 max-w-[620px] text-[12px] leading-[18px] text-[var(--text-secondary)]">
								{explanation}
							</p>
						)}
						{running && source.path?.progress && (
							<p className="mt-1 text-[11px] tabular-nums text-[var(--text-tertiary)]">
								{source.path.progress.placed} of {source.path.progress.total} files organized
							</p>
						)}
					</div>
					<div className="min-w-0 flex-[1_1_480px]">
						<div className="flex flex-wrap items-center gap-2">
							<div className="flex max-w-full flex-wrap items-center gap-2 text-[12px] text-[var(--text-secondary)]">
								<label className="flex items-center gap-2">
									Review agent
									<select
										aria-label="Review agent"
										value={agentId}
										disabled={busy || readOnly || agentSettings.isPending}
										onChange={(event) => setSelectedAgent(event.target.value)}
										className="h-8 rounded-[6px] border border-[var(--border)] bg-[var(--bg-base)] px-2 text-[12px] text-[var(--text)] disabled:opacity-50"
									>
										{!agentId && (
											<option value="" disabled>
												Choose an agent
											</option>
										)}
										<option value="codex">Codex</option>
										<option value="claude">Claude Code</option>
									</select>
								</label>
								{preparing ? (
									<button type="button" disabled className={primary}>
										Preparing…
									</button>
								) : running ? (
									<button
										type="button"
										onClick={onOpenAgent}
										disabled={!onOpenAgent}
										className={primary}
									>
										Open agent workspace
									</button>
								) : ready ? (
									<button type="button" onClick={onReadPath} className={primary}>
										Follow reading path
									</button>
								) : (
									<button
										type="button"
										onClick={launch}
										disabled={disabled}
										aria-describedby={unavailable ? reasonId : undefined}
										className={primary}
									>
										{stale
											? "Update agent review"
											: failed
												? "Retry agent review"
												: "Start agent review"}
									</button>
								)}
							</div>
							{!preparing && findingsCount > 0 && onOpenFindings && (
								<button type="button" onClick={onOpenFindings} className={secondary}>
									Review findings · {findingsCount}
								</button>
							)}
							{!busy && onOpenAgent && (
								<button type="button" onClick={onOpenAgent} className={secondary}>
									Open agent workspace
								</button>
							)}
							<button type="button" onClick={onBrowseFiles} className={secondary}>
								Browse files
							</button>
							{running && (
								<button type="button" onClick={source.stop} className={secondary}>
									Stop
								</button>
							)}
						</div>
						<div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-[var(--text-secondary)]">
							<label className="flex items-center gap-2">
								<input
									type="checkbox"
									checked={settings.alsoReview}
									disabled={busy || readOnly}
									onChange={(event) => settings.setAlsoReview(event.target.checked)}
									className="accent-[var(--accent)]"
								/>
								Also review code for findings
							</label>
							<details className="relative">
								<summary className="cursor-pointer rounded px-1 py-1 text-[var(--text-tertiary)] focus-visible:outline focus-visible:outline-[var(--accent)]">
									Review options
								</summary>
								<div className="absolute left-0 top-full z-40 mt-1 w-[280px] max-w-[calc(100vw-32px)] rounded-[8px] border border-[var(--border)] bg-[var(--bg-elevated)] p-3 shadow-[var(--shadow-lg)]">
									{ready && (
										<button
											type="button"
											onClick={launch}
											disabled={disabled}
											className={`${secondary} mb-3 w-full`}
										>
											Run again
										</button>
									)}
									<label className="flex items-start gap-2 leading-[18px]">
										<input
											type="checkbox"
											checked={settings.autoMapOnReviewRequest}
											disabled={readOnly}
											onChange={(event) => settings.setAutoMapOnReviewRequest(event.target.checked)}
											className="mt-0.5 accent-[var(--accent)]"
										/>
										Start automatically when I’m asked to review a PR
									</label>
									{settings.error && (
										<p role="alert" className="mt-2 text-[11px] text-[var(--color-danger)]">
											Could not save review options: {settings.error}
										</p>
									)}
								</div>
							</details>
							{unavailable && (
								<p id={reasonId} className="text-[11px] text-[var(--text-tertiary)]">
									{unavailable}
								</p>
							)}
						</div>
					</div>
				</div>
				{error && !running && (
					<details className="mt-2 text-[11px] text-[var(--text-tertiary)]">
						<summary className="cursor-pointer">What happened</summary>
						<p className="mt-1 whitespace-pre-wrap break-words">{error}</p>
					</details>
				)}
				{!compact && (
					<p className="mt-3 text-[11px] leading-[18px] text-[var(--text-tertiary)]">
						1 Choose how to review · 2 Read files and findings · 3 Submit review
					</p>
				)}
			</div>
		</section>
	);
}
