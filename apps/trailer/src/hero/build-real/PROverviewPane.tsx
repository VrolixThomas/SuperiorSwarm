// Mirrors apps/desktop/src/renderer/components/PROverviewTab.tsx.
// Static, no-tRPC, no-store version for the marketing trailer.
// PRHeader is defined here (moved from PRControlRail.tsx) and re-exported so
// PRControlRail can still use it without duplication.

import {
	MOCK_PR,
	type MockPRDetails,
	SHOWCASE_REVIEW_THREADS,
	type ShowcaseReviewThread,
} from "./pr-showcase";

// ── PRHeader (mirrors PROverviewTab PRHeader) ───────────────────────────────

export function PRHeader({ details }: { details: MockPRDetails }) {
	const stateColor: Record<string, string> = {
		OPEN: "bg-[var(--success-subtle)] text-[var(--color-success)]",
		CLOSED: "bg-[var(--danger-subtle)] text-[var(--color-danger)]",
		MERGED: "bg-[var(--purple-subtle)] text-[var(--color-purple)]",
	};

	const decisionLabel: Record<string, string> = {
		APPROVED: "Approved",
		CHANGES_REQUESTED: "Changes requested",
		REVIEW_REQUIRED: "Review required",
	};

	const decisionColor: Record<string, string> = {
		APPROVED: "bg-[var(--success-subtle)] text-[var(--color-success)]",
		CHANGES_REQUESTED: "bg-[var(--danger-subtle)] text-[var(--color-danger)]",
		REVIEW_REQUIRED: "bg-[var(--warning-subtle)] text-[var(--color-warning)]",
	};

	const reviewerDecisionIcon: Record<string, string> = {
		APPROVED: "✓",
		CHANGES_REQUESTED: "✗",
		COMMENTED: "○",
		PENDING: "○",
	};

	const reviewerDecisionColor: Record<string, string> = {
		APPROVED: "text-[var(--color-success)]",
		CHANGES_REQUESTED: "text-[var(--color-danger)]",
		COMMENTED: "text-[var(--text-quaternary)]",
		PENDING: "text-[var(--text-quaternary)]",
	};

	return (
		<div className="border-b border-[var(--border-subtle)] px-6 py-5">
			{/* Title */}
			<h1 className="text-[18px] font-semibold leading-tight text-[var(--text)]">
				{details.title}
			</h1>

			{/* Metadata line */}
			<div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12px] text-[var(--text-tertiary)]">
				<span>#{details.number}</span>
				<span>by</span>
				<span className="text-[var(--text-secondary)]">{details.author}</span>
				<span className="text-[var(--text-quaternary)]">&middot;</span>
				<span className="font-mono text-[11px]">
					{details.targetBranch} &larr; {details.sourceBranch}
				</span>
				<span className="text-[var(--text-quaternary)]">&middot;</span>
				<span>
					{details.files.length} file{details.files.length !== 1 ? "s" : ""}
				</span>
			</div>

			{/* Status pills */}
			<div className="mt-3 flex flex-wrap items-center gap-2">
				<span
					className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ${stateColor[details.state] ?? ""}`}
				>
					{details.isDraft
						? "Draft"
						: details.state.charAt(0) + details.state.slice(1).toLowerCase()}
				</span>

				{details.reviewDecision && (
					<span
						className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ${decisionColor[details.reviewDecision] ?? ""}`}
					>
						{decisionLabel[details.reviewDecision] ?? details.reviewDecision}
					</span>
				)}

				{details.ciState && (
					<span
						className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
							details.ciState === "SUCCESS"
								? "bg-[var(--success-subtle)] text-[var(--color-success)]"
								: details.ciState === "FAILURE"
									? "bg-[var(--danger-subtle)] text-[var(--color-danger)]"
									: "bg-[var(--warning-subtle)] text-[var(--color-warning)]"
						}`}
					>
						{details.ciState === "SUCCESS"
							? "✓ CI passed"
							: details.ciState === "FAILURE"
								? "✗ CI failed"
								: "● CI pending"}
					</span>
				)}

				<span className="inline-flex items-center rounded-full bg-[var(--bg-overlay)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--text-tertiary)]">
					{details.resolvedCount} resolved
				</span>
				{details.unresolvedCount > 0 && (
					<span className="inline-flex items-center rounded-full bg-[var(--warning-subtle)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--color-warning)]">
						{details.unresolvedCount} unresolved
					</span>
				)}
			</div>

			{/* Reviewer avatars */}
			{details.reviewers.length > 0 && (
				<div className="mt-3 flex items-center gap-3">
					{details.reviewers.map((r) => (
						<div
							key={r.login}
							className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]"
						>
							<div className="relative">
								{r.avatarUrl ? (
									<img src={r.avatarUrl} alt={r.login} className="h-5 w-5 rounded-full" />
								) : (
									<div className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--bg-elevated)] text-[9px] font-medium text-[var(--text-tertiary)]">
										{r.login.charAt(0).toUpperCase()}
									</div>
								)}
								{r.decision && (
									<span
										className={`absolute -bottom-0.5 -right-0.5 text-[8px] font-bold ${reviewerDecisionColor[r.decision] ?? ""}`}
									>
										{reviewerDecisionIcon[r.decision] ?? ""}
									</span>
								)}
							</div>
							<span>{r.login}</span>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

// ── AISummaryCard (mirrors PROverviewTab AISummaryCard, default expanded) ───

function AISummaryCard() {
	return (
		<div className="mx-6 mt-5 overflow-hidden rounded-[8px] border border-[var(--border-subtle)]">
			<div className="flex w-full items-center gap-2 bg-[var(--bg-elevated)] px-4 py-2.5 text-left">
				<span className="ai-badge">AI</span>
				<span className="flex-1 text-[12px] font-medium text-[var(--text-secondary)]">
					Review Summary
				</span>
				<span
					className="text-[10px] text-[var(--text-quaternary)] transition-transform"
					style={{ transform: "rotate(0deg)" }}
				>
					&#9660;
				</span>
			</div>
			<div className="bg-[var(--bg-surface)] px-4 py-3">
				{/* Hand-authored markdown content (replaces MarkdownRenderer). */}
				<h2 className="mt-3 mb-1 text-[12px] font-semibold text-[var(--text)]">Overview</h2>
				<p className="text-[12px] leading-[1.55] text-[var(--text-secondary)]">
					Introduces in-app agent terminal chat backed by a streaming PTY surface. Removes the
					polling-based{" "}
					<code className="font-mono text-[11px] text-[var(--accent)]">AgentStreamIndicator</code>{" "}
					in favor of a subscription-driven hook and consolidates MCP server registration around
					stable identifiers.
				</p>

				<h2 className="mt-3 mb-1 text-[12px] font-semibold text-[var(--text)]">Key changes</h2>
				<ul className="mt-1 list-disc pl-5 text-[12px] leading-[1.55] text-[var(--text-secondary)]">
					<li className="mt-1">
						<code className="font-mono text-[11px] text-[var(--accent)]">
							useAgentTerminalStream.ts
						</code>{" "}
						— new hook returning a subscription handle; lifecycle now cancels on terminal close (was
						leaking on unmount).
					</li>
					<li className="mt-1">
						<code className="font-mono text-[11px] text-[var(--accent)]">Terminal.tsx</code> — wires
						xterm theme through context; opens a default tab when no agent is active.
					</li>
					<li className="mt-1">
						<code className="font-mono text-[11px] text-[var(--accent)]">SolveSidebar.tsx</code> —
						surfaces per-group commit state once the solver finishes.
					</li>
					<li className="mt-1">
						<code className="font-mono text-[11px] text-[var(--accent)]">
							comment-solver-orchestrator.ts
						</code>{" "}
						— funnels agent events through a single emitter so the new sidebar can subscribe without
						duplicating fan-out logic.
					</li>
					<li className="mt-1">
						<code className="font-mono text-[11px] text-[var(--accent)]">
							mcp-server-registry.ts
						</code>{" "}
						— derives stable IDs from{" "}
						<code className="font-mono text-[11px] text-[var(--accent)]">name + version</code>, no
						longer the refresh counter.
					</li>
				</ul>

				<h2 className="mt-3 mb-1 text-[12px] font-semibold text-[var(--text)]">Risk: Low</h2>
				<p className="text-[12px] leading-[1.55] text-[var(--text-secondary)]">
					The hook rewrite is covered by the new{" "}
					<code className="font-mono text-[11px] text-[var(--accent)]">f1d3c4e</code> tests for
					unmount + sessionId-change paths. MCP id derivation is backwards-compatible with the
					existing on-disk registry shape.
				</p>

				<h2 className="mt-3 mb-1 text-[12px] font-semibold text-[var(--text)]">Recommendations</h2>
				<ul className="mt-1 list-disc pl-5 text-[12px] leading-[1.55] text-[var(--text-secondary)]">
					<li className="mt-1">
						<strong className="text-[var(--text)]">
							Cancel the stream subscription on terminal close
						</strong>{" "}
						— currently relying on{" "}
						<code className="font-mono text-[11px] text-[var(--accent)]">useRef</code> cleanup;
						return the unsubscribe handle from{" "}
						<code className="font-mono text-[11px] text-[var(--accent)]">useEffect</code> directly.
					</li>
					<li className="mt-1">
						<strong className="text-[var(--text)]">Pass theme through xterm options</strong> —
						propagate the theme prop into{" "}
						<code className="font-mono text-[11px] text-[var(--accent)]">Terminal.tsx</code> instead
						of relying on the global stylesheet.
					</li>
					<li className="mt-1">
						<strong className="text-[var(--text)]">Stable MCP server identifiers</strong> —
						addressed in <code className="font-mono text-[11px] text-[var(--accent)]">7e2a195</code>
						; consider documenting the id derivation in{" "}
						<code className="font-mono text-[11px] text-[var(--accent)]">
							mcp-standalone/README.md
						</code>
						.
					</li>
					<li className="mt-1">
						<strong className="text-[var(--text)]">Add tests for terminal cleanup</strong> — landed
						in <code className="font-mono text-[11px] text-[var(--accent)]">f1d3c4e</code>; covers
						unmount and sessionId rotation.
					</li>
				</ul>
			</div>
		</div>
	);
}

// ── Body renderer (replaces MarkdownRenderer for comment bodies) ────────────
// Splits a comment body on triple-backtick fences and renders alternating
// paragraph blocks + <pre><code> code blocks.

function ThreadBody({ body }: { body: string }) {
	const segments = body.split(/```\n?/);
	return (
		<>
			{segments.map((seg, i) => {
				const isCode = i % 2 === 1;
				if (isCode) {
					return (
						<pre
							// biome-ignore lint/suspicious/noArrayIndexKey: static markdown segments, order is stable
							key={i}
							className="my-2 overflow-x-auto rounded-[4px] bg-[var(--bg-elevated)] p-2 font-mono text-[11px] text-[var(--text-secondary)]"
						>
							<code>{seg.replace(/\n$/, "")}</code>
						</pre>
					);
				}
				if (!seg.trim()) return null;
				return (
					<p
						// biome-ignore lint/suspicious/noArrayIndexKey: static markdown segments, order is stable
						key={i}
						className="text-[12px] leading-[1.55] text-[var(--text-secondary)] whitespace-pre-wrap"
					>
						{seg.replace(/^\n+|\n+$/g, "")}
					</p>
				);
			})}
		</>
	);
}

// ── GitHubThreadCard (mirrors PROverviewTab GitHubThreadCard) ───────────────

function GitHubThreadCard({ thread }: { thread: ShowcaseReviewThread }) {
	return (
		<div
			className={`overflow-hidden rounded-[6px] border border-[var(--border-subtle)] bg-[var(--bg-surface)] ${
				thread.isResolved ? "opacity-50" : ""
			}`}
		>
			{/* Header */}
			<div className="flex items-center gap-1.5 border-b border-[var(--border-subtle)] px-3 py-1.5">
				<span className="font-mono text-[10px] text-[var(--text-quaternary)]">
					{thread.filename}
					{thread.line != null && `:${thread.line}`}
				</span>
				<div className="flex-1" />
				{thread.isResolved ? (
					<span className="text-[10px] text-[var(--color-success)]">Resolved</span>
				) : (
					<span className="text-[10px] text-[var(--text-quaternary)]">Resolve</span>
				)}
			</div>

			{/* Comments */}
			{thread.comments.map((c) => (
				<div
					key={c.id}
					className="border-b border-[var(--border-subtle)] px-3 py-2 last:border-b-0"
				>
					<div className="mb-0.5 flex items-center gap-1.5 text-[10px]">
						<span className="font-medium text-[var(--text-secondary)]">{c.author}</span>
						<span className="text-[var(--text-quaternary)]">{c.createdAtRelative}</span>
					</div>
					<ThreadBody body={c.body} />
				</div>
			))}

			{/* Reply (static, collapsed state) */}
			{!thread.isResolved && (
				<div className="border-t border-[var(--border-subtle)]">
					<div className="w-full px-3 py-1.5 text-left text-[10px] text-[var(--text-quaternary)]">
						Reply...
					</div>
				</div>
			)}
		</div>
	);
}

// ── CommentsFeed (mirrors PROverviewTab CommentsFeed read-only branch) ──────

function CommentsFeed({ threads }: { threads: ShowcaseReviewThread[] }) {
	const unresolved = threads.filter((t) => !t.isResolved);
	const resolved = threads.filter((t) => t.isResolved);

	return (
		<div className="mx-6 mt-5">
			<h2 className="mb-3 text-[13px] font-medium text-[var(--text-secondary)]">
				Comments ({threads.length})
			</h2>
			<div className="flex flex-col gap-2.5">
				{unresolved.map((t) => (
					<GitHubThreadCard key={t.id} thread={t} />
				))}
				{resolved.length > 0 && (
					<>
						<div className="mt-2 text-[10px] font-medium uppercase tracking-wide text-[var(--text-quaternary)]">
							Resolved ({resolved.length})
						</div>
						{resolved.map((t) => (
							<GitHubThreadCard key={t.id} thread={t} />
						))}
					</>
				)}
			</div>
		</div>
	);
}

// ── Root: PROverviewPane ────────────────────────────────────────────────────

export function PROverviewPane() {
	return (
		<div className="flex h-full flex-col overflow-y-auto bg-[var(--bg-surface)]">
			<PRHeader details={MOCK_PR} />
			<AISummaryCard />
			<CommentsFeed threads={SHOWCASE_REVIEW_THREADS} />
		</div>
	);
}
