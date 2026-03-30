"use client";

import { StaggerChild } from "./section";

/* ------------------------------------------------------------------ */
/*  Abstract visual vignettes for each feature                        */
/* ------------------------------------------------------------------ */

function PrIntelligenceVisual() {
	return (
		<div className="relative flex items-center justify-center">
			{/* Glow behind */}
			<div className="pointer-events-none absolute h-[300px] w-[300px] rounded-full bg-[radial-gradient(ellipse,rgba(196,149,108,0.06)_0%,transparent_70%)]" />

			<div className="relative w-[300px] space-y-2.5" aria-hidden="true">
				{/* AI review comment card — matches real CommentThreadCard */}
				<div className="rounded-[6px] border border-border bg-bg-surface">
					<div className="flex items-center gap-1.5 border-b border-border px-3 py-1.5">
						<span className="rounded-[3px] bg-accent-dim px-1.5 py-px text-[9px] font-semibold text-accent">
							AI
						</span>
						<span className="font-mono text-[10px] text-text-faint">
							chat-service.ts:47
						</span>
						<span className="ml-auto text-[10px] text-text-faint">PR #34</span>
					</div>
					<p className="px-3 py-2 text-[11px] leading-relaxed text-text-secondary">
						Messages are dispatched without a queue. If two agents respond simultaneously,
						messages will interleave. Add a message queue that serializes writes.
					</p>
					<div className="flex items-center gap-2 border-t border-border px-3 py-1.5">
						<button
							type="button"
							className="rounded-[4px] bg-green/15 px-2 py-0.5 text-[10px] font-medium text-green"
						>
							Accept
						</button>
						<button
							type="button"
							className="rounded-[4px] bg-bg-elevated px-2 py-0.5 text-[10px] text-text-muted"
						>
							Decline
						</button>
					</div>
				</div>

				{/* Solved commit group — matches real CommentSolverView */}
				<div className="rounded-[6px] border border-border bg-bg-surface">
					<div className="flex items-center gap-2 px-3 py-2">
						<span className="text-[11px] text-green">✓</span>
						<span className="text-[11px] font-medium text-text-primary">
							2/2 comments resolved
						</span>
						<span className="ml-auto font-mono text-[10px] text-text-faint">a7f3c21</span>
					</div>
				</div>
			</div>
		</div>
	);
}

function AgentOrchestrationVisual() {
	return (
		<div className="relative flex items-center justify-center">
			{/* Glow behind */}
			<div className="pointer-events-none absolute h-[300px] w-[300px] rounded-full bg-[radial-gradient(ellipse,rgba(196,149,108,0.06)_0%,transparent_70%)]" />

			{/* Mini terminal multiplexer — matches real app window */}
			<div className="relative w-[300px] overflow-hidden rounded-[6px] border border-border bg-bg-elevated" aria-hidden="true">
				{/* Window chrome with agent indicator */}
				<div className="flex items-center justify-between border-b border-border px-2.5 py-1.5">
					<div className="flex items-center gap-1.5">
						<div className="size-2 rounded-full bg-red" />
						<div className="size-2 rounded-full bg-yellow" />
						<div className="size-2 rounded-full bg-green" />
					</div>
					<span className="text-[10px] text-text-muted">SuperiorSwarm</span>
					<div className="flex items-center gap-1.5">
						<span className="relative flex size-1.5">
							<span className="absolute inline-flex size-full animate-ping rounded-full bg-green opacity-40" />
							<span className="relative inline-flex size-1.5 rounded-full bg-green" />
						</span>
						<span className="text-[9px] text-text-muted">3 agents</span>
					</div>
				</div>

				{/* Terminal tabs — matches real terminal tab bar */}
				<div className="flex border-b border-border bg-bg-surface">
					{[
						{ label: "Claude Code", active: true },
						{ label: "Codex", active: false },
						{ label: "Gemini CLI", active: false },
					].map((tab) => (
						<div
							key={tab.label}
							className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] ${
								tab.active
									? "border-b border-accent bg-bg-base text-text-primary"
									: "text-text-faint"
							}`}
						>
							<span className="relative flex size-1.5">
								<span className="relative inline-flex size-1.5 rounded-full bg-green" />
							</span>
							{tab.label}
						</div>
					))}
				</div>

				{/* Terminal content — matches real Claude Code session */}
				<div className="bg-bg-base px-3 py-2 font-mono text-[10px] leading-relaxed">
					<div className="text-text-muted">
						~/SuperiorSwarm on{" "}
						<span className="text-purple">feature/inline-agent-chat</span>
					</div>
					<div className="text-text-faint">
						{">"} implement the ChatPanel component
					</div>
					<div className="mt-1.5 text-text-faint">
						<span className="text-text-muted">{"│"}</span> Analyzing codebase...
					</div>
					<div className="text-green">
						✓ Created src/renderer/hooks/useAgentChat.ts
					</div>
					<div className="text-green">
						✓ Created src/renderer/components/ChatPanel.tsx
					</div>
				</div>
			</div>
		</div>
	);
}

function IntegrationVisual() {
	return (
		<div className="relative flex items-center justify-center">
			{/* Glow behind */}
			<div className="pointer-events-none absolute h-[300px] w-[300px] rounded-full bg-[radial-gradient(ellipse,rgba(196,149,108,0.06)_0%,transparent_70%)]" />

			{/* Mini sidebar — matches real app Sidebar with segmented control */}
			<div className="relative w-[260px] overflow-hidden rounded-[6px] border border-border bg-bg-surface" aria-hidden="true">
				{/* Segmented control — matches real sidebar tabs */}
				<div className="flex gap-1 border-b border-border px-2 py-1.5">
					{["Repos", "Tickets", "PRs"].map((tab) => (
						<span
							key={tab}
							className={`flex-1 rounded-[5px] py-1 text-center text-[10px] font-medium ${
								tab === "Tickets"
									? "bg-bg-elevated text-text-secondary"
									: "text-text-faint"
							}`}
						>
							{tab}
						</span>
					))}
				</div>

				{/* Ticket list — real data from mock-data.ts */}
				<div className="py-1">
					{/* Section header — matches real TicketsSidebar */}
					<div className="px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.5px] text-text-faint">
						Linear · SuperiorSwarm
					</div>

					{[
						{ key: "SUP-12", title: "Inline agent chatting in terminal panes", status: "In Progress" },
						{ key: "SUP-11", title: "Worktree shared files configuration UI", status: "Todo" },
						{ key: "SUP-10", title: "Review draft follow-up rounds", status: "Todo" },
						{ key: "SUP-9", title: "Terminal scrollback persistence", status: "Done" },
					].map((ticket) => (
						<div
							key={ticket.key}
							className={`flex items-center gap-2 px-2 py-1.5 text-[11px] ${
								ticket.key === "SUP-12" ? "bg-bg-elevated" : ""
							}`}
						>
							{/* Status icon — matches real ticket status icons */}
							<svg className="size-[10px] shrink-0" viewBox="0 0 14 14" fill="none" aria-hidden="true">
								{ticket.status === "In Progress" ? (
									<circle cx="7" cy="7" r="5.5" stroke="#febc2e" strokeWidth="1.5" strokeDasharray="8 4" />
								) : ticket.status === "Todo" ? (
									<circle cx="7" cy="7" r="5.5" stroke="#636366" strokeWidth="1.5" />
								) : (
									<>
										<circle cx="7" cy="7" r="5.5" stroke="#28c840" strokeWidth="1.5" />
										<path d="M4.5 7.5L6 9L9.5 5.5" stroke="#28c840" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
									</>
								)}
							</svg>
							<span className="text-[10px] font-medium text-text-faint">{ticket.key}</span>
							<span className="min-w-0 flex-1 truncate text-text-primary">{ticket.title}</span>
						</div>
					))}
				</div>

				{/* Footer — matches real sidebar footer */}
				<div className="flex items-center gap-1 border-t border-border p-2">
					<div className="flex flex-1 items-center gap-2 rounded-[6px] px-2 py-1 text-[11px] text-text-faint">
						<svg className="size-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
							<circle cx="8" cy="8" r="6" />
							<path d="M8 5v3l2 2" strokeLinecap="round" />
						</svg>
						Settings
					</div>
				</div>
			</div>
		</div>
	);
}

/* ------------------------------------------------------------------ */
/*  Feature data                                                       */
/* ------------------------------------------------------------------ */

const FEATURES = [
	{
		headline: "Your PRs, reviewed before you ask.",
		copy: "AI reviews every pull request automatically — finds issues, suggests fixes, and resolves review comments. You push code, it handles the rest.",
		visual: <PrIntelligenceVisual />,
		align: "left" as const,
	},
	{
		headline: "Every agent. One window.",
		copy: "See what every AI coding agent is doing across all your workspaces at a glance. Spawn, monitor, and manage them without switching terminals.",
		visual: <AgentOrchestrationVisual />,
		align: "right" as const,
	},
	{
		headline: "Jira. Linear. GitHub. Bitbucket.\nOne sidebar.",
		copy: "Stop tab-switching between your issue tracker, git host, and code. Everything lives in one unified sidebar — tickets, branches, and PRs together.",
		visual: <IntegrationVisual />,
		align: "left" as const,
	},
];

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export function FeatureSections() {
	return (
		<div className="mx-auto max-w-5xl px-6">
			{FEATURES.map((feature) => (
				<section key={feature.headline} aria-label={feature.headline} className="py-24 md:py-40">
					<div
						className={`flex flex-col items-center gap-12 md:flex-row md:gap-16 ${
							feature.align === "right" ? "md:flex-row-reverse" : ""
						}`}
					>
						{/* Text */}
						<div className="flex-1 text-center md:text-left">
							<StaggerChild index={0}>
								<h2 className="whitespace-pre-line text-3xl font-semibold tracking-tight text-text-primary md:text-5xl md:leading-[1.1]">
									{feature.headline}
								</h2>
							</StaggerChild>
							<StaggerChild index={1}>
								<p className="mx-auto mt-4 max-w-lg text-base leading-relaxed text-text-secondary md:mx-0 md:text-lg">
									{feature.copy}
								</p>
							</StaggerChild>
						</div>

						{/* Visual */}
						<StaggerChild index={2} className="flex-1 flex justify-center">
							{feature.visual}
						</StaggerChild>
					</div>
				</section>
			))}
		</div>
	);
}
