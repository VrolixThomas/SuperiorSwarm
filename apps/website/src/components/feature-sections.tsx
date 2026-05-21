"use client";

import { StaggerChild } from "./section";

/* ------------------------------------------------------------------ */
/*  Abstract visual vignettes for each feature                        */
/* ------------------------------------------------------------------ */

function PrIntelligenceVisual() {
	return (
		<div className="relative flex items-center justify-center">
			{/* Glow behind */}
			<div className="pointer-events-none absolute h-[300px] w-[300px] rounded-full bg-[radial-gradient(ellipse,rgba(10,132,255,0.06)_0%,transparent_70%)]" />

			<div className="relative w-[300px] space-y-2.5" aria-hidden="true">
				{/* AI review comment card — matches real CommentThreadCard */}
				<div className="rounded-[6px] border border-app-border-subtle bg-app-bg-surface">
					<div className="flex items-center gap-1.5 border-b border-app-border-subtle px-3 py-1.5">
						<span className="rounded-[3px] bg-app-accent-subtle px-1.5 py-px text-[9px] font-semibold text-app-accent">
							AI
						</span>
						<span className="font-mono text-[10px] text-app-text-quaternary">
							chat-service.ts:47
						</span>
						<span className="ml-auto text-[10px] text-app-text-quaternary">PR #34</span>
					</div>
					<p className="px-3 py-2 text-[11px] leading-relaxed text-app-text-secondary">
						Messages are dispatched without a queue. If two agents respond simultaneously, messages
						will interleave. Add a message queue that serializes writes.
					</p>
					<div className="flex items-center gap-2 border-t border-app-border-subtle px-3 py-1.5">
						<button
							type="button"
							className="rounded-[4px] bg-app-success/15 px-2 py-0.5 text-[10px] font-medium text-app-success"
						>
							Accept
						</button>
						<button
							type="button"
							className="rounded-[4px] bg-app-bg-elevated px-2 py-0.5 text-[10px] text-app-text-tertiary"
						>
							Decline
						</button>
					</div>
				</div>

				{/* Solved commit group — matches real CommentSolverView */}
				<div className="rounded-[6px] border border-app-border-subtle bg-app-bg-surface">
					<div className="flex items-center gap-2 px-3 py-2">
						<span className="text-[11px] text-app-success">✓</span>
						<span className="text-[11px] font-medium text-app-text">2/2 comments resolved</span>
						<span className="ml-auto font-mono text-[10px] text-app-text-quaternary">a7f3c21</span>
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
			<div className="pointer-events-none absolute h-[300px] w-[300px] rounded-full bg-[radial-gradient(ellipse,rgba(10,132,255,0.06)_0%,transparent_70%)]" />

			{/* Mini terminal multiplexer — matches real app window */}
			<div
				className="relative w-[300px] overflow-hidden rounded-[6px] border border-app-border-subtle bg-app-bg-elevated"
				aria-hidden="true"
			>
				{/* Window chrome with agent indicator */}
				<div className="flex items-center justify-between border-b border-app-border-subtle px-2.5 py-1.5">
					<div className="flex items-center gap-1.5">
						<div className="size-2 rounded-full bg-app-danger" />
						<div className="size-2 rounded-full bg-app-warning" />
						<div className="size-2 rounded-full bg-app-success" />
					</div>
					<span className="text-[10px] text-app-text-tertiary">SuperiorSwarm</span>
					<div className="flex items-center gap-1.5">
						<span className="relative flex size-1.5">
							<span className="absolute inline-flex size-full animate-ping rounded-full bg-app-success opacity-40" />
							<span className="relative inline-flex size-1.5 rounded-full bg-app-success" />
						</span>
						<span className="text-[9px] text-app-text-tertiary">3 agents</span>
					</div>
				</div>

				{/* Terminal tabs — matches real terminal tab bar */}
				<div className="flex border-b border-app-border-subtle bg-app-bg-surface">
					{[
						{ label: "Claude Code", active: true },
						{ label: "Codex", active: false },
						{ label: "Gemini CLI", active: false },
					].map((tab) => (
						<div
							key={tab.label}
							className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] ${
								tab.active
									? "border-b border-app-accent bg-app-bg-base text-app-text"
									: "text-app-text-quaternary"
							}`}
						>
							<span className="relative flex size-1.5">
								<span className="relative inline-flex size-1.5 rounded-full bg-app-success" />
							</span>
							{tab.label}
						</div>
					))}
				</div>

				{/* Terminal content — matches real Claude Code session */}
				<div className="bg-app-bg-base px-3 py-2 font-mono text-[10px] leading-relaxed">
					<div className="text-app-text-tertiary">
						~/SuperiorSwarm on <span className="text-app-purple">feature/inline-agent-chat</span>
					</div>
					<div className="text-app-text-quaternary">{">"} implement the ChatPanel component</div>
					<div className="mt-1.5 text-app-text-quaternary">
						<span className="text-app-text-tertiary">{"│"}</span> Analyzing codebase...
					</div>
					<div className="text-app-success">✓ Created src/renderer/hooks/useAgentChat.ts</div>
					<div className="text-app-success">✓ Created src/renderer/components/ChatPanel.tsx</div>
				</div>
			</div>
		</div>
	);
}

function OrchestrateVisual() {
	return (
		<div className="relative flex items-center justify-center">
			<div className="pointer-events-none absolute h-[300px] w-[300px] rounded-full bg-[radial-gradient(ellipse,rgba(10,132,255,0.06)_0%,transparent_70%)]" />

			<div
				className="relative w-[300px] overflow-hidden rounded-[6px] border border-app-border-subtle bg-app-bg-surface"
				aria-hidden="true"
			>
				{/* Orchestrator header row — muted orch-1 palette */}
				<div className="relative flex items-center gap-2 px-3 py-2">
					<svg
						viewBox="0 0 12 12"
						className="size-3 shrink-0"
						fill="none"
						stroke="var(--color-orch-1)"
						strokeWidth="1.5"
						aria-hidden="true"
					>
						<circle cx="6" cy="2.5" r="1.2" />
						<circle cx="2.5" cy="8" r="1.2" />
						<circle cx="9.5" cy="8" r="1.2" />
						<path d="M6 4L3 8M6 4L9 8" strokeLinecap="round" />
					</svg>
					<span className="text-[12px] font-semibold text-app-text">Release v1.0</span>
					<span
						className="ml-auto shrink-0 rounded-[9px] px-[7px] py-px text-[10px] font-medium tabular-nums"
						style={{
							background: "var(--color-orch-1-bg)",
							color: "var(--color-orch-1)",
							minWidth: 16,
						}}
					>
						3
					</span>
				</div>

				{/* Attached worktrees with orch-1 vertical rail */}
				<div className="relative pb-2">
					<div
						className="pointer-events-none absolute w-[2px] rounded-[1px]"
						style={{
							left: 26,
							top: 0,
							bottom: 8,
							background: "var(--color-orch-1)",
							opacity: 0.55,
						}}
						aria-hidden="true"
					/>
					{[
						{ name: "feature/inline-chat", agent: "Claude Code", state: "running" },
						{ name: "review/PR-110", agent: "Codex", state: "running" },
						{ name: "voice-input", agent: "Gemini CLI", state: "idle" },
					].map((row) => (
						<div
							key={row.name}
							className="relative flex items-center gap-2 py-[7px] pl-[36px] pr-3"
						>
							<span className="relative flex size-1.5 shrink-0">
								{row.state === "running" ? (
									<>
										<span className="absolute inline-flex size-full animate-ping rounded-full bg-app-success opacity-40" />
										<span className="relative inline-flex size-1.5 rounded-full bg-app-success" />
									</>
								) : (
									<span className="relative inline-flex size-1.5 rounded-full bg-app-text-quaternary" />
								)}
							</span>
							<span className="min-w-0 flex-1 truncate font-mono text-[10px] text-app-text-secondary">
								{row.name}
							</span>
							<span className="rounded-[3px] bg-app-bg-elevated px-1.5 py-px text-[9px] text-app-text-tertiary">
								{row.agent}
							</span>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}

function McpVisual() {
	return (
		<div className="relative flex items-center justify-center">
			<div className="pointer-events-none absolute h-[300px] w-[300px] rounded-full bg-[radial-gradient(ellipse,rgba(10,132,255,0.06)_0%,transparent_70%)]" />

			<div className="relative w-[280px]" aria-hidden="true">
				{/* MCP tool-call card */}
				<div className="overflow-hidden rounded-[6px] border border-app-border-subtle bg-app-bg-surface">
					<div className="flex items-center justify-between border-b border-app-border-subtle px-3 py-1.5">
						<span className="font-mono text-[10px] text-app-text-quaternary">
							mcp · superiorswarm
						</span>
						<span className="rounded-[3px] bg-app-success/15 px-1.5 py-px text-[9px] font-medium text-app-success">
							connected
						</span>
					</div>
					<ul className="divide-y divide-border">
						{[
							{ name: "create_worktree", status: "ok" },
							{ name: "dispatch_agent", status: "ok" },
							{ name: "send_message", status: "pending" },
							{ name: "read_messages", status: "ok" },
						].map((tool) => (
							<li key={tool.name} className="flex items-center gap-2 px-3 py-1.5">
								<span className="font-mono text-[10px] text-app-text-secondary">{tool.name}</span>
								<span className="ml-auto">
									{tool.status === "ok" ? (
										<span className="text-[10px] text-app-success">✓</span>
									) : (
										<span className="relative flex size-1.5">
											<span className="absolute inline-flex size-full animate-ping rounded-full bg-app-warning opacity-50" />
											<span className="relative inline-flex size-1.5 rounded-full bg-app-warning" />
										</span>
									)}
								</span>
							</li>
						))}
					</ul>
				</div>

				{/* Voice support footnote */}
				<div className="mt-2 flex items-center gap-1.5 rounded-[6px] border border-app-border-subtle/60 bg-app-bg-surface/60 px-3 py-1.5">
					<svg
						viewBox="0 0 12 12"
						className="size-3 text-app-text-tertiary"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.4"
						aria-hidden="true"
					>
						<rect x="4.5" y="1.5" width="3" height="6" rx="1.5" />
						<path d="M2.5 6a3.5 3.5 0 0 0 7 0M6 9.5v1.5" strokeLinecap="round" />
					</svg>
					<span className="font-mono text-[9px] text-app-text-quaternary">
						mic wired · <span className="text-app-text-tertiary">/voice</span> supported
					</span>
				</div>
			</div>
		</div>
	);
}

function IntegrationVisual() {
	return (
		<div className="relative flex items-center justify-center">
			{/* Glow behind */}
			<div className="pointer-events-none absolute h-[300px] w-[300px] rounded-full bg-[radial-gradient(ellipse,rgba(10,132,255,0.06)_0%,transparent_70%)]" />

			{/* Mini sidebar — matches real app Sidebar with segmented control */}
			<div
				className="relative w-[260px] overflow-hidden rounded-[6px] border border-app-border-subtle bg-app-bg-surface"
				aria-hidden="true"
			>
				{/* Segmented control — matches real sidebar tabs */}
				<div className="flex gap-1 border-b border-app-border-subtle px-2 py-1.5">
					{["Repos", "Tickets", "PRs"].map((tab) => (
						<span
							key={tab}
							className={`flex-1 rounded-[5px] py-1 text-center text-[10px] font-medium ${
								tab === "Tickets"
									? "bg-app-bg-elevated text-app-text-secondary"
									: "text-app-text-quaternary"
							}`}
						>
							{tab}
						</span>
					))}
				</div>

				{/* Ticket list — real data from mock-data.ts */}
				<div className="py-1">
					{/* Source row — Jira, Linear, GitHub, Bitbucket */}
					<div className="flex items-center gap-1.5 px-2 py-1.5 text-[9px] font-semibold uppercase tracking-[0.5px] text-app-text-quaternary">
						{["Jira", "Linear", "GitHub", "Bitbucket"].map((src, i) => (
							<span
								key={src}
								className={`rounded-[3px] px-1.5 py-0.5 ${
									i === 1
										? "bg-app-accent-subtle text-app-accent"
										: "bg-app-bg-elevated text-app-text-quaternary"
								}`}
							>
								{src}
							</span>
						))}
					</div>

					{[
						{
							key: "SUP-12",
							title: "Inline agent chatting in terminal panes",
							status: "In Progress",
						},
						{ key: "SUP-11", title: "Worktree shared files configuration UI", status: "Todo" },
						{ key: "SUP-10", title: "Review draft follow-up rounds", status: "Todo" },
						{ key: "SUP-9", title: "Terminal scrollback persistence", status: "Done" },
					].map((ticket) => (
						<div
							key={ticket.key}
							className={`flex items-center gap-2 px-2 py-1.5 text-[11px] ${
								ticket.key === "SUP-12" ? "bg-app-bg-elevated" : ""
							}`}
						>
							{/* Status icon — matches real ticket status icons */}
							<svg
								className="size-[10px] shrink-0"
								viewBox="0 0 14 14"
								fill="none"
								aria-hidden="true"
							>
								{ticket.status === "In Progress" ? (
									<circle
										cx="7"
										cy="7"
										r="5.5"
										stroke="#febc2e"
										strokeWidth="1.5"
										strokeDasharray="8 4"
									/>
								) : ticket.status === "Todo" ? (
									<circle cx="7" cy="7" r="5.5" stroke="#636366" strokeWidth="1.5" />
								) : (
									<>
										<circle cx="7" cy="7" r="5.5" stroke="#28c840" strokeWidth="1.5" />
										<path
											d="M4.5 7.5L6 9L9.5 5.5"
											stroke="#28c840"
											strokeWidth="1.5"
											strokeLinecap="round"
											strokeLinejoin="round"
										/>
									</>
								)}
							</svg>
							<span className="text-[10px] font-medium text-app-text-quaternary">{ticket.key}</span>
							<span className="min-w-0 flex-1 truncate text-app-text">{ticket.title}</span>
						</div>
					))}
				</div>

				{/* Footer — matches real sidebar footer */}
				<div className="flex items-center gap-1 border-t border-app-border-subtle p-2">
					<div className="flex flex-1 items-center gap-2 rounded-[6px] px-2 py-1 text-[11px] text-app-text-quaternary">
						<svg
							className="size-3"
							viewBox="0 0 16 16"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.5"
							aria-hidden="true"
						>
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
		copy: "AI reviews every pull request automatically. Finds issues, suggests fixes, and resolves review comments. You push code, it handles the rest.",
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
		headline: "Orchestrate the swarm.",
		copy: "One orchestrator coordinates the rest. Group worktrees under a coordinator, hand off work between agents, and let sessions resume across context windows.",
		visual: <OrchestrateVisual />,
		align: "left" as const,
	},
	{
		headline: "MCP everywhere.",
		copy: "A built-in MCP control plane lets agents spawn worktrees, dispatch each other, and exchange messages through standard tool calls. Mic access is wired through too, so Claude Code's /voice just works.",
		visual: <McpVisual />,
		align: "right" as const,
	},
	{
		headline: "Jira. Linear. GitHub. Bitbucket.\nOne sidebar.",
		copy: "Stop tab-switching between your issue tracker, git host, and code. Everything lives in one unified sidebar with tickets, branches, and PRs together.",
		visual: <IntegrationVisual />,
		align: "left" as const,
	},
];

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export function FeatureSections() {
	return (
		<div id="features" className="mx-auto max-w-5xl px-6">
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
								<h2 className="whitespace-pre-line text-3xl font-semibold tracking-tight text-app-text md:text-5xl md:leading-[1.1]">
									{feature.headline}
								</h2>
							</StaggerChild>
							<StaggerChild index={1}>
								<p className="mx-auto mt-4 max-w-lg text-base leading-relaxed text-app-text-secondary md:mx-0 md:text-lg">
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
