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

			<div className="relative overflow-hidden rounded-xl border border-app-border-subtle bg-app-bg-elevated shadow-[0_40px_100px_rgba(0,0,0,0.6)]">
				{/* macOS window chrome */}
				<div className="flex items-center justify-between border-b border-app-border-subtle px-3 py-2">
					<div className="flex items-center gap-1.5">
						<div className="size-2.5 rounded-full bg-app-danger" />
						<div className="size-2.5 rounded-full bg-app-warning" />
						<div className="size-2.5 rounded-full bg-app-success" />
					</div>
					<span className="text-[11px] text-app-text-tertiary">SuperiorSwarm</span>
					<div className="flex items-center gap-1.5">
						<span className="relative flex size-2">
							<span className="absolute inline-flex size-full animate-ping rounded-full bg-app-success opacity-40" />
							<span className="relative inline-flex size-2 rounded-full bg-app-success" />
						</span>
						<span className="text-[10px] text-app-text-tertiary">3 agents</span>
					</div>
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

				{/* Desktop 3-panel layout */}
				<div className="hidden md:flex" style={{ height: 480 }}>
					{/* Left sidebar */}
					<div className="w-[220px] shrink-0 overflow-y-auto border-r border-app-border-subtle bg-app-bg-surface">
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

					{/* Right panel */}
					{showRightPanel && (
						<div className="w-[300px] shrink-0 overflow-y-auto border-l border-app-border-subtle bg-app-bg-surface">
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
							<div className="border-t border-app-border-subtle">
								{solverActive ? <DiffView /> : <TerminalView />}
							</div>
							{solverActive && (
								<div className="border-t border-app-border-subtle">
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
	return (
		<div className="flex shrink-0 items-center gap-2 border-b border-app-border-subtle px-3 py-1">
			{/* Branch chip — matches real BranchChip */}
			<div className="flex items-center gap-1.5 rounded-[5px] bg-app-bg-elevated px-2 py-1">
				<svg
					aria-hidden="true"
					width="10"
					height="10"
					viewBox="0 0 16 16"
					fill="currentColor"
					className="shrink-0 text-app-text-quaternary"
				>
					<path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.5 2.5 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Z" />
				</svg>
				<span className="font-mono text-[11px] text-app-text-secondary">
					feature/inline-agent-chat
				</span>
				<span className="text-[10px] text-app-text-quaternary">·</span>
				<span className="font-mono text-[10px] text-app-text-quaternary">main</span>
			</div>

			{/* Quick actions: push / pull / fetch */}
			<div className="ml-auto flex items-center gap-0.5">
				{[
					{ label: "Pull", path: "M8 2v8M5 7l3 3 3-3" },
					{ label: "Push", path: "M8 14V6M5 9l3-3 3 3" },
					{ label: "Fetch", path: "M3 8a5 5 0 0 1 9-3M13 8a5 5 0 0 1-9 3M12 2v3h-3M4 14v-3h3" },
				].map((a) => (
					<button
						key={a.label}
						type="button"
						title={a.label}
						className="flex h-[24px] w-[24px] items-center justify-center rounded-[5px] text-app-text-quaternary transition-colors hover:bg-app-bg-elevated hover:text-app-text-secondary"
					>
						<svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
							<path
								d={a.path}
								stroke="currentColor"
								strokeWidth="1.4"
								strokeLinecap="round"
								strokeLinejoin="round"
							/>
						</svg>
					</button>
				))}
			</div>
		</div>
	);
}
