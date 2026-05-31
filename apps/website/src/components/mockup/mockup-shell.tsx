"use client";

import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { CommentSolverView } from "./comment-solver-view";
import { DiffPanelView } from "./diff-panel-view";
import { DiffView } from "./diff-view";
import { PrDetailView } from "./pr-detail-view";
import { ReviewPanel } from "./review-panel";
import { Sidebar } from "./sidebar";
import { TerminalView } from "./terminal-view";
import { TicketBoardView } from "./ticket-board-view";

export type Segment = "repos" | "tickets" | "prs";
export type RightPanel = "review" | "solver" | "hidden";

export function MockupShell() {
	const [segment, setSegment] = useState<Segment>("repos");
	const [selectedPr, setSelectedPr] = useState<number | null>(null);
	const [rightPanel, setRightPanel] = useState<RightPanel>("hidden");
	const [solverActive, setSolverActive] = useState(false);
	const reduced = useReducedMotion();

	function handleSegmentChange(s: Segment) {
		setSegment(s);
		setSelectedPr(null);
		setRightPanel("hidden");
		setSolverActive(false);
	}

	function handlePrSelect(prId: number) {
		setSelectedPr(prId);
		setRightPanel("review");
	}

	function handleFixClick() {
		setRightPanel("solver");
		setSolverActive(true);
	}

	// Real app keeps the diff panel open by default for repos + PR review,
	// collapsing it only on the tickets segment (App.tsx:592-603, 717).
	const showRightPanel =
		solverActive || segment === "repos" || (segment === "prs" && selectedPr !== null);

	return (
		<motion.section
			initial={reduced ? false : { opacity: 0, y: 30 }}
			whileInView={{ opacity: 1, y: 0 }}
			viewport={{ once: true, amount: 0.15 }}
			transition={{ duration: 0.7, ease: "easeOut" }}
			className="relative mx-auto max-w-[1200px] px-4 pt-4 md:px-8"
			aria-label="Interactive preview of SuperiorSwarm desktop app"
		>
			{/* Glow halo behind mockup */}
			<div
				className="pointer-events-none absolute -inset-8 rounded-3xl bg-[radial-gradient(ellipse_at_center,var(--color-brand-glow)_0%,transparent_60%)]"
				style={{ animation: reduced ? "none" : "glow-breathe 8s ease-in-out infinite" }}
			/>

			<div className="relative overflow-hidden rounded-xl border border-app-border-subtle bg-app-bg-elevated shadow-[0_40px_100px_rgba(0,0,0,0.6)]">
				{/* macOS window chrome */}
				<div className="relative flex items-center border-b border-app-border-subtle px-3 py-2">
					<div className="flex items-center gap-1.5">
						<div className="size-2.5 rounded-full bg-app-danger" />
						<div className="size-2.5 rounded-full bg-app-warning" />
						<div className="size-2.5 rounded-full bg-app-success" />
					</div>
					<span className="absolute left-1/2 -translate-x-1/2 text-[11px] text-app-text-tertiary">
						SuperiorSwarm
					</span>
				</div>

				{/* Mobile tab bar */}
				<div className="flex border-b border-app-border-subtle md:hidden">
					{(["repos", "tickets", "prs"] as const).map((s) => (
						<button
							key={s}
							type="button"
							onClick={() => handleSegmentChange(s)}
							className={`flex-1 py-2 text-xs font-medium capitalize transition-colors ${
								segment === s
									? "border-b-2 border-app-accent text-app-accent"
									: "text-app-text-tertiary"
							}`}
						>
							{s === "prs" ? "PRs" : s}
						</button>
					))}
				</div>

				{/* Desktop 3-panel layout — proportions mirror App.tsx (sidebar 15.3% / main / diff 19.4%) */}
				<div className="hidden md:flex" style={{ height: 660 }}>
					{/* Left sidebar */}
					<div className="basis-[16%] min-w-0 shrink-0 grow-0 overflow-y-auto border-r border-app-border-subtle bg-app-bg-surface">
						<Sidebar
							segment={segment}
							onSegmentChange={handleSegmentChange}
							selectedPr={selectedPr}
							onPrSelect={handlePrSelect}
						/>
					</div>

					{/* Center panel */}
					<div className="flex min-w-0 flex-1 flex-col bg-app-bg-base">
						{/* Branch chip header — matches real MainContentArea.tsx:66-79 */}
						{segment !== "tickets" && <BranchChipHeader />}

						{segment === "repos" && (solverActive ? <DiffView /> : <TerminalView />)}
						{segment === "tickets" && <TicketBoardView />}
						{segment === "prs" && selectedPr !== null && <PrDetailView />}
						{segment === "prs" && selectedPr === null && (
							<div className="flex flex-1 items-center justify-center text-xs text-app-text-quaternary">
								Select a PR to view details
							</div>
						)}
					</div>

					{/* Right panel — diff panel by default, swaps to review/solver in the PR flow */}
					{showRightPanel && (
						<div className="basis-[20%] min-w-0 shrink-0 grow-0 overflow-y-auto border-l border-app-border-subtle bg-app-bg-surface">
							{solverActive ? (
								<CommentSolverView />
							) : segment === "prs" && selectedPr !== null ? (
								<ReviewPanel prId={selectedPr} onFixClick={handleFixClick} segment={segment} />
							) : (
								<DiffPanelView />
							)}
						</div>
					)}
				</div>

				{/* Mobile stacked layout */}
				<div className="md:hidden">
					{segment === "repos" && (
						<>
							<Sidebar
								segment="repos"
								onSegmentChange={handleSegmentChange}
								selectedPr={null}
								onPrSelect={handlePrSelect}
								mobile
							/>
							<div className="border-t border-app-border-subtle">
								{solverActive ? <DiffView /> : <TerminalView />}
							</div>
							{solverActive ? (
								<div className="border-t border-app-border-subtle">
									<CommentSolverView />
								</div>
							) : (
								<div className="h-[360px] border-t border-app-border-subtle">
									<DiffPanelView />
								</div>
							)}
						</>
					)}
					{segment === "tickets" && <TicketBoardView />}
					{segment === "prs" && (
						<>
							<Sidebar
								segment="prs"
								onSegmentChange={handleSegmentChange}
								selectedPr={selectedPr}
								onPrSelect={handlePrSelect}
								mobile
							/>
							{selectedPr !== null && (
								<>
									<div className="border-t border-app-border-subtle">
										<PrDetailView />
									</div>
									<div className="border-t border-app-border-subtle">
										{rightPanel === "solver" ? (
											<CommentSolverView />
										) : (
											<ReviewPanel
												prId={selectedPr}
												onFixClick={handleFixClick}
												segment={segment}
											/>
										)}
									</div>
								</>
							)}
						</>
					)}
				</div>
			</div>

			{/* Bottom fade gradient */}
			<div className="pointer-events-none absolute -bottom-1 left-0 right-0 h-24 bg-gradient-to-t from-bg-base to-transparent" />
		</motion.section>
	);
}

function BranchChipHeader() {
	// Matches real BranchChip.tsx + QuickActionBar.tsx empty-state.
	// BranchChip = single button: branch icon + name + ahead/behind badges + chevron.
	// QuickActionBar with no user-defined actions renders only a "+" button.
	return (
		<div className="flex shrink-0 items-center gap-2 border-b border-app-border-subtle px-3 py-1">
			<button
				type="button"
				className="flex items-center gap-1.5 rounded-[6px] border border-app-border bg-app-bg-overlay px-2 py-1 text-[12px] transition-colors hover:bg-app-bg-active"
			>
				<svg
					aria-hidden="true"
					width="12"
					height="12"
					viewBox="0 0 24 24"
					fill="none"
					stroke="var(--color-app-text-secondary)"
					strokeWidth="2"
					className="shrink-0"
				>
					<path d="M6 3v12" />
					<circle cx="18" cy="6" r="3" />
					<circle cx="6" cy="18" r="3" />
					<path d="M18 9a9 9 0 0 1-9 9" />
				</svg>
				<span className="max-w-[200px] truncate font-medium text-app-text">
					orchestrator-ordering
				</span>
				<span
					className="rounded-full px-1.5 text-[10px]"
					style={{
						background: "rgba(48,209,88,0.10)",
						color: "var(--color-app-success)",
					}}
				>
					↑3
				</span>
				<svg
					aria-hidden="true"
					width="8"
					height="8"
					viewBox="0 0 24 24"
					fill="none"
					stroke="var(--color-app-text-quaternary)"
					strokeWidth="2.5"
				>
					<path d="m6 9 6 6 6-6" />
				</svg>
			</button>

			{/* QuickActionBar empty-state: just a + */}
			<button
				type="button"
				className="ml-1 shrink-0 rounded-[6px] px-2 py-0.5 text-[12px] text-app-text-quaternary transition-colors hover:text-app-text-secondary"
				title="Add quick action"
			>
				+
			</button>
		</div>
	);
}
