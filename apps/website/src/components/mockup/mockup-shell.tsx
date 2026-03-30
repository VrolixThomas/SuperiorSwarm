"use client";

import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { CommentSolverView } from "./comment-solver-view";
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

	const showRightPanel =
		(segment === "prs" && selectedPr !== null && rightPanel !== "hidden") || solverActive;

	return (
		<motion.section
			initial={reduced ? false : { opacity: 0, y: 30 }}
			whileInView={{ opacity: 1, y: 0 }}
			viewport={{ once: true, amount: 0.15 }}
			transition={{ duration: 0.7, ease: "easeOut" }}
			className="relative mx-auto max-w-[1060px] px-4 pt-4 md:px-8"
			aria-label="Interactive preview of SuperiorSwarm desktop app"
		>
			{/* Glow halo behind mockup */}
			<div
				className="pointer-events-none absolute -inset-8 rounded-3xl bg-[radial-gradient(ellipse_at_center,var(--color-brand-glow)_0%,transparent_60%)]"
				style={{ animation: reduced ? "none" : "glow-breathe 8s ease-in-out infinite" }}
			/>

			<div className="relative overflow-hidden rounded-xl border border-border bg-bg-elevated shadow-[0_40px_100px_rgba(0,0,0,0.6)]">
				{/* macOS window chrome */}
				<div className="flex items-center justify-between border-b border-border px-3 py-2">
					<div className="flex items-center gap-1.5">
						<div className="size-2.5 rounded-full bg-red" />
						<div className="size-2.5 rounded-full bg-yellow" />
						<div className="size-2.5 rounded-full bg-green" />
					</div>
					<span className="text-[11px] text-text-muted">SuperiorSwarm</span>
					<div className="flex items-center gap-1.5">
						<span className="relative flex size-2">
							<span className="absolute inline-flex size-full animate-ping rounded-full bg-green opacity-40" />
							<span className="relative inline-flex size-2 rounded-full bg-green" />
						</span>
						<span className="text-[10px] text-text-muted">3 agents</span>
					</div>
				</div>

				{/* Mobile tab bar */}
				<div className="flex border-b border-border md:hidden">
					{(["repos", "tickets", "prs"] as const).map((s) => (
						<button
							key={s}
							type="button"
							onClick={() => handleSegmentChange(s)}
							className={`flex-1 py-2 text-xs font-medium capitalize transition-colors ${
								segment === s ? "border-b-2 border-accent text-accent" : "text-text-muted"
							}`}
						>
							{s === "prs" ? "PRs" : s}
						</button>
					))}
				</div>

				{/* Desktop 3-panel layout */}
				<div className="hidden md:flex" style={{ height: 480 }}>
					{/* Left sidebar */}
					<div className="w-[220px] shrink-0 overflow-y-auto border-r border-border bg-bg-surface">
						<Sidebar
							segment={segment}
							onSegmentChange={handleSegmentChange}
							selectedPr={selectedPr}
							onPrSelect={handlePrSelect}
						/>
					</div>

					{/* Center panel */}
					<div className="flex min-w-0 flex-1 flex-col bg-bg-base">
						{segment === "repos" && (solverActive ? <DiffView /> : <TerminalView />)}
						{segment === "tickets" && <TicketBoardView />}
						{segment === "prs" && selectedPr !== null && <PrDetailView />}
						{segment === "prs" && selectedPr === null && (
							<div className="flex flex-1 items-center justify-center text-xs text-text-faint">
								Select a PR to view details
							</div>
						)}
					</div>

					{/* Right panel */}
					{showRightPanel && (
						<div className="w-[300px] shrink-0 overflow-y-auto border-l border-border bg-bg-surface">
							{rightPanel === "review" && selectedPr !== null && (
								<ReviewPanel prId={selectedPr} onFixClick={handleFixClick} segment={segment} />
							)}
							{rightPanel === "solver" && <CommentSolverView />}
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
							<div className="border-t border-border">
								{solverActive ? <DiffView /> : <TerminalView />}
							</div>
							{solverActive && (
								<div className="border-t border-border">
									<CommentSolverView />
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
									<div className="border-t border-border">
										<PrDetailView />
									</div>
									<div className="border-t border-border">
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
