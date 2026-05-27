import { useState } from "react";
import { PROJECTS, PULL_REQUESTS, TICKETS } from "./mock-data";
import type { Segment } from "./mockup-shell";

export function Sidebar({
	segment,
	onSegmentChange,
	selectedPr,
	onPrSelect,
	mobile = false,
}: {
	segment: Segment;
	onSegmentChange: (s: Segment) => void;
	selectedPr: number | null;
	onPrSelect: (id: number) => void;
	mobile?: boolean;
}) {
	return (
		<div className="flex h-full w-full flex-col overflow-hidden bg-app-bg-surface">
			{/* Segmented control — matches real Sidebar.tsx:57-84 */}
			{!mobile && (
				<div className="flex gap-1 border-b border-app-border-subtle px-2 py-1.5">
					{(["repos", "tickets", "prs"] as const).map((seg) => (
						<button
							key={seg}
							type="button"
							onClick={() => onSegmentChange(seg)}
							className={`flex-1 rounded-[5px] py-1 text-[10px] font-medium capitalize transition-colors ${
								segment === seg
									? "bg-app-bg-elevated text-app-text-secondary"
									: "text-app-text-quaternary hover:text-app-text-tertiary"
							}`}
						>
							{seg === "prs" ? "PRs" : seg.charAt(0).toUpperCase() + seg.slice(1)}
						</button>
					))}
				</div>
			)}

			{/* Segment content */}
			<div className="flex-1 overflow-y-auto">
				{segment === "repos" && <ReposView />}
				{segment === "tickets" && <TicketsView />}
				{segment === "prs" && <PrsView selectedPr={selectedPr} onPrSelect={onPrSelect} />}
			</div>

			{/* Footer — Settings (single button, mirrors real Sidebar.tsx:121-153) */}
			<div className="flex items-center border-t border-app-border-subtle p-2">
				<button
					type="button"
					className="flex flex-1 items-center gap-2 rounded-[6px] px-3 py-1.5 text-[13px] text-app-text-tertiary transition-all duration-[120ms] hover:bg-app-bg-elevated hover:text-app-text-secondary"
				>
					<svg
						aria-hidden="true"
						width="15"
						height="15"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.5"
						strokeLinecap="round"
						strokeLinejoin="round"
						className="shrink-0"
					>
						<circle cx="12" cy="12" r="3" />
						<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
					</svg>
					<span className="truncate">Settings</span>
				</button>
			</div>
		</div>
	);
}

/* ── Repos View — clones ProjectItem.tsx tree shape ─────────────────────── */

function ReposView() {
	return (
		<>
			<div className="flex flex-col gap-2 px-2 pt-2">
				{PROJECTS.map((project, i) => (
					<ProjectGroup key={project.id} project={project} defaultExpanded={i === 0} />
				))}
			</div>

			{/* Add Repository button */}
			<div className="px-2 py-1.5">
				<button
					type="button"
					className="flex w-full items-center gap-2 rounded-[6px] px-3 py-1.5 text-[12px] text-app-text-quaternary transition-all duration-[120ms] hover:bg-app-bg-elevated hover:text-app-text-tertiary"
				>
					<svg
						aria-hidden="true"
						width="13"
						height="13"
						viewBox="0 0 16 16"
						fill="none"
						className="shrink-0"
					>
						<path
							d="M8 3v10M3 8h10"
							stroke="currentColor"
							strokeWidth="1.5"
							strokeLinecap="round"
						/>
					</svg>
					<span className="truncate">Add Repository</span>
				</button>
			</div>
		</>
	);
}

type ProjectNode = (typeof PROJECTS)[number];

function ProjectGroup({
	project,
	defaultExpanded,
}: {
	project: ProjectNode;
	defaultExpanded: boolean;
}) {
	const [expanded, setExpanded] = useState(defaultExpanded);
	const hasActiveChild =
		project.orchestrators.some((o) => o.children.some((c) => c.active)) ||
		project.loose.some((w) => w.active);

	return (
		<div>
			{/* RepoGroup-style header — name + new-worktree + chevron */}
			<button
				type="button"
				onClick={() => setExpanded((p) => !p)}
				className={[
					"flex w-full items-center gap-2 rounded-[8px] px-3 py-1.5 text-left transition-colors duration-[120ms]",
					hasActiveChild ? "text-app-text" : "text-app-text-tertiary",
				].join(" ")}
			>
				<span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{project.name}</span>
				<span
					className={[
						"flex h-5 w-5 shrink-0 items-center justify-center rounded text-[14px]",
						hasActiveChild
							? "text-app-text-quaternary hover:text-app-text-secondary"
							: "text-app-text-quaternary/40",
					].join(" ")}
				>
					+
				</span>
				<svg
					aria-hidden="true"
					width="10"
					height="10"
					viewBox="0 0 10 10"
					fill="none"
					className={[
						"shrink-0 text-app-text-quaternary transition-transform duration-[120ms]",
						expanded ? "rotate-90" : "rotate-0",
					].join(" ")}
				>
					<path
						d="M3 1.5L7 5L3 8.5"
						stroke="currentColor"
						strokeWidth="1.3"
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
				</svg>
			</button>

			{/* Workspace tree */}
			{expanded && (
				<div className="flex flex-col pt-0.5">
					{project.orchestrators.map((orch) => (
						<OrchestratorGroupBlock key={orch.id} orch={orch} isInActiveProject={hasActiveChild} />
					))}
					{project.loose.map((ws) => (
						<WorkspaceRow
							key={ws.id}
							workspace={ws}
							indentLevel={0}
							isInActiveProject={hasActiveChild}
						/>
					))}
				</div>
			)}
		</div>
	);
}

/* ── OrchestratorRow + OrchestratorGroup — verbatim from real components ── */

type OrchestratorNode = ProjectNode["orchestrators"][number];

function OrchestratorGroupBlock({
	orch,
	isInActiveProject,
}: {
	orch: OrchestratorNode;
	isInActiveProject: boolean;
}) {
	const [expanded, setExpanded] = useState(true);
	const hasActiveChild = orch.children.some((c) => c.active);

	const swatch = `var(--color-orch-${orch.colorIndex})`;
	const swatchBg = `var(--color-orch-${orch.colorIndex}-bg)`;

	return (
		<>
			<OrchestratorRow
				orch={orch}
				swatch={swatch}
				swatchBg={swatchBg}
				expanded={expanded}
				onToggle={() => setExpanded((p) => !p)}
				hasActiveChild={hasActiveChild}
			/>
			{expanded && (
				<div className="relative pl-[14px]">
					<span
						aria-hidden="true"
						className="absolute w-[2px] rounded-[2px]"
						style={{
							left: "26px",
							top: "2px",
							bottom: "4px",
							background: swatch,
							opacity: hasActiveChild ? 1 : 0.55,
						}}
					/>
					{orch.children.map((c) => (
						<WorkspaceRow
							key={c.id}
							workspace={c}
							indentLevel={1}
							isInActiveProject={isInActiveProject}
						/>
					))}
				</div>
			)}
		</>
	);
}

function OrchestratorRow({
	orch,
	swatch,
	swatchBg,
	expanded,
	onToggle,
	hasActiveChild,
}: {
	orch: OrchestratorNode;
	swatch: string;
	swatchBg: string;
	expanded: boolean;
	onToggle: () => void;
	hasActiveChild: boolean;
}) {
	// Collapsed + has-active-child → row gets accent treatment
	const isAccented = !expanded && hasActiveChild;
	return (
		<div
			className={[
				"group relative flex items-center w-full rounded-[6px] transition-colors duration-[120ms]",
				isAccented ? "bg-app-accent-subtle" : "bg-transparent hover:bg-app-bg-elevated",
			].join(" ")}
		>
			{isAccented && (
				<span
					aria-hidden="true"
					className="absolute left-0 top-1 bottom-1 w-[3px] rounded-r-[2px] bg-app-accent z-10 pointer-events-none"
				/>
			)}

			<button
				type="button"
				className="flex min-w-0 flex-1 items-center gap-2 border-none rounded-[6px] bg-transparent py-[7px] pl-[22px] pr-2 text-left"
			>
				{/* tri-circle orchestrator glyph — matches OrchestratorRow.tsx:180-199 */}
				<svg
					aria-label="Orchestrator"
					role="img"
					width="12"
					height="12"
					viewBox="0 0 12 12"
					fill="none"
					className="shrink-0"
				>
					<title>Orchestrator</title>
					<circle cx="6" cy="2.5" r="1.4" stroke={swatch} strokeWidth="1.2" />
					<circle cx="2.5" cy="9.5" r="1.4" stroke={swatch} strokeWidth="1.2" />
					<circle cx="9.5" cy="9.5" r="1.4" stroke={swatch} strokeWidth="1.2" />
					<path d="M6 4 L3 8 M6 4 L9 8" stroke={swatch} strokeWidth="1.2" strokeLinecap="round" />
				</svg>
				<span className="min-w-0 flex-1 truncate text-[13px] font-medium text-app-text-secondary">
					{orch.name}
				</span>
				<span
					className="rounded-[9px] px-[7px] py-px text-center text-[10px] font-medium tabular-nums"
					style={{ background: swatchBg, color: swatch, minWidth: 16 }}
					title={`${orch.children.length} worktrees attached`}
				>
					{orch.children.length}
				</span>
			</button>

			{/* Chevron */}
			<button
				type="button"
				onClick={onToggle}
				aria-label={expanded ? "Collapse" : "Expand"}
				className="flex shrink-0 items-center justify-center rounded-[6px] bg-transparent px-2 py-[7px] hover:bg-app-bg-overlay"
			>
				<svg
					aria-hidden="true"
					width="10"
					height="10"
					viewBox="0 0 10 10"
					fill="none"
					className={[
						"shrink-0 text-app-text-quaternary transition-transform duration-[120ms]",
						expanded ? "rotate-90" : "rotate-0",
					].join(" ")}
				>
					<path
						d="M3 1.5L7 5L3 8.5"
						stroke="currentColor"
						strokeWidth="1.3"
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
				</svg>
			</button>
		</div>
	);
}

/* ── WorkspaceItem clone — matches WorkspaceItem.tsx:491-607 ────────────── */

type Workspace = {
	id: string;
	name: string;
	active: boolean;
	statusText?: string;
	currentPhase?: "working" | "blocked" | "done";
};

function WorkspaceRow({
	workspace,
	indentLevel,
	isInActiveProject,
}: {
	workspace: Workspace;
	indentLevel: 0 | 1;
	isInActiveProject: boolean;
}) {
	const isActive = workspace.active;
	return (
		<div className="group relative">
			<button
				type="button"
				className={[
					"relative flex w-full items-center gap-2 border-none rounded-[6px] text-left",
					indentLevel === 1 ? "pl-[36px] pr-3 py-[7px]" : "pl-[22px] pr-3 py-[7px]",
					"cursor-pointer transition-all duration-[120ms]",
					isActive
						? "bg-app-accent-subtle hover:bg-app-accent-subtle"
						: "bg-transparent hover:bg-app-bg-elevated",
				].join(" ")}
			>
				{isActive && isInActiveProject && (
					<span
						aria-hidden="true"
						className="absolute left-0 top-1 bottom-1 w-[3px] rounded-r-[2px] bg-app-accent"
					/>
				)}
				<div className="min-w-0 flex-1">
					<span
						className={[
							"block truncate text-[13px]",
							isActive
								? "font-medium text-app-text"
								: isInActiveProject
									? "text-app-text-secondary"
									: "text-app-text-tertiary",
						].join(" ")}
					>
						{workspace.name}
					</span>
					{workspace.statusText && (
						<span className="mt-0.5 block truncate text-[11px] text-app-text-secondary">
							{workspace.statusText}
						</span>
					)}
				</div>
				{workspace.currentPhase === "working" && (
					<span
						className="ml-auto inline-block h-1.5 w-1.5 rounded-full bg-app-accent"
						title="working"
					/>
				)}
				{workspace.currentPhase === "blocked" && (
					<span
						className="ml-auto inline-block h-1.5 w-1.5 rounded-full"
						style={{ background: "var(--color-app-term-yellow)" }}
						title="blocked"
					/>
				)}
				{workspace.currentPhase === "done" && (
					<span
						className="ml-auto inline-block h-1.5 w-1.5 rounded-full"
						style={{ background: "var(--color-app-term-green)" }}
						title="done"
					/>
				)}
			</button>
		</div>
	);
}

/* ── Tickets View ───────────────────────────────────────────────────────── */

function TicketsView() {
	const totalCount = TICKETS.length;

	return (
		<div className="flex flex-col gap-1 px-2 py-1">
			<button
				type="button"
				className="relative flex w-full items-center gap-2 rounded-[6px] bg-app-accent-subtle px-2 py-1.5 text-left text-[11px] font-medium text-app-text transition-colors duration-[120ms]"
			>
				<span
					className="absolute left-0 top-1 bottom-1 w-[3px] rounded-r-[2px] bg-app-accent"
					aria-hidden="true"
				/>
				<svg
					width="11"
					height="11"
					viewBox="0 0 16 16"
					fill="none"
					className="shrink-0"
					aria-hidden="true"
				>
					<rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" />
					<rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" />
					<rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" />
					<rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" />
				</svg>
				<span className="flex-1">All Tickets</span>
				<span className="text-[10px] tabular-nums text-app-text-quaternary">{totalCount}</span>
			</button>

			<div className="mx-2 my-1 h-px bg-app-border-subtle" />

			<div className="px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.5px] text-app-text-quaternary">
				Linear
			</div>

			<button
				type="button"
				className="flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-[11px] text-app-text-secondary transition-colors duration-[120ms] hover:bg-app-bg-elevated"
			>
				<div className="h-[6px] w-[6px] shrink-0 rounded-full bg-app-text-quaternary" />
				<span className="flex-1 truncate">SuperiorSwarm</span>
				<span className="text-[10px] tabular-nums text-app-text-quaternary">{totalCount}</span>
			</button>
		</div>
	);
}

/* ── PRs View — 3-line layout matching PullRequestItem.tsx ──────────────── */

function PrsView({
	selectedPr,
	onPrSelect,
}: {
	selectedPr: number | null;
	onPrSelect: (id: number) => void;
}) {
	return (
		<div className="flex flex-col gap-2 px-2 pt-2">
			{PULL_REQUESTS.map((group) => (
				<div key={group.repo}>
					<button
						type="button"
						className="flex w-full items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.05em] text-app-text-quaternary transition-colors hover:text-app-text-tertiary"
					>
						<svg
							aria-hidden="true"
							width="8"
							height="8"
							viewBox="0 0 10 10"
							fill="none"
							className="shrink-0 rotate-90 transition-transform duration-150"
						>
							<path
								d="M3 1.5L7 5L3 8.5"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
							/>
						</svg>
						<span
							className={`shrink-0 rounded-[3px] px-1 py-px text-[8px] font-semibold uppercase tracking-[0.05em] ${
								group.source === "bitbucket"
									? "bg-[rgba(38,132,255,0.16)] text-[#5b8def]"
									: "bg-app-bg-elevated text-app-text-quaternary"
							}`}
						>
							{group.source === "bitbucket" ? "BB" : "GH"}
						</span>
						<span className="truncate">{group.repo}</span>
						<span className="ml-auto text-[10px] tabular-nums opacity-60">{group.prs.length}</span>
					</button>

					<div className="flex flex-col">
						{group.prs.map((pr) => {
							const healthVar =
								pr.status === "success"
									? "var(--color-pr-health-success)"
									: pr.status === "pending"
										? "var(--color-pr-health-warning)"
										: "var(--color-pr-health-neutral)";
							const isActive = selectedPr === pr.id;
							const reviewers = REVIEWER_FALLBACK;

							return (
								<button
									key={pr.id}
									type="button"
									onClick={() => onPrSelect(pr.id)}
									className={[
										"group relative flex w-full flex-col gap-0.5 rounded-[6px] py-[7px] pl-[22px] pr-3 text-left text-[12px] transition-all duration-[120ms]",
										isActive
											? "bg-app-accent-subtle text-app-text"
											: "text-app-text-tertiary hover:bg-app-bg-elevated hover:text-app-text-secondary",
									].join(" ")}
									title={`${group.repo}#${pr.id}: ${pr.title}`}
								>
									{isActive && (
										<span
											className="absolute left-0 top-1 bottom-1 w-[3px] rounded-r-[2px] bg-app-accent"
											aria-hidden="true"
										/>
									)}

									<div className="flex items-center gap-1.5">
										<span className="min-w-0 flex-1 truncate text-[12px] leading-tight">
											{pr.title}
										</span>
										<span
											className="size-1.5 shrink-0 rounded-full"
											style={{ backgroundColor: healthVar }}
										/>
										<span className="shrink-0 font-mono text-[10px] text-app-text-quaternary">
											#{pr.id}
										</span>
									</div>

									<div className="flex items-center gap-1 font-mono text-[10px] text-app-text-quaternary">
										<span className="min-w-0 truncate">{pr.branch}</span>
										<span className="shrink-0">{">"}</span>
										<span className="shrink-0 truncate">{pr.target}</span>
									</div>

									<div className="mt-0.5 flex items-center gap-1.5">
										<div className="flex size-4 shrink-0 items-center justify-center rounded-full bg-app-bg-overlay text-[7px] font-bold text-app-text-tertiary">
											{pr.authorInitial}
										</div>
										<span className="truncate text-[10px] text-app-text-quaternary">
											{pr.author}
										</span>
										{reviewers.length > 0 && (
											<div className="ml-auto flex items-center -space-x-1.5">
												{reviewers.slice(0, 3).map((r, i) => (
													<div
														key={`${pr.id}-${i}`}
														className="flex size-5 items-center justify-center rounded-full bg-app-bg-elevated text-[8px] font-medium text-app-text-tertiary"
														style={{ border: `2px solid ${decisionBorder(r.decision)}` }}
														title={`${r.initial} · ${r.decision}`}
													>
														{r.initial}
													</div>
												))}
											</div>
										)}
									</div>
								</button>
							);
						})}
					</div>
				</div>
			))}
		</div>
	);
}

const REVIEWER_FALLBACK: { initial: string; decision: string }[] = [
	{ initial: "M", decision: "approved" },
	{ initial: "K", decision: "pending" },
];

function decisionBorder(decision: string): string {
	switch (decision) {
		case "approved":
			return "var(--color-pr-health-success)";
		case "changes":
			return "var(--color-pr-health-warning)";
		default:
			return "var(--color-pr-health-neutral)";
	}
}
