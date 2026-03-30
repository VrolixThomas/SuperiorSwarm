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
		<div className="flex h-full w-full flex-col overflow-hidden bg-bg-surface">
			{/* Segmented control */}
			{!mobile && (
				<div className="flex gap-1 px-2 py-1.5 border-b border-border">
					{(["repos", "tickets", "prs"] as const).map((seg) => (
						<button
							key={seg}
							type="button"
							onClick={() => onSegmentChange(seg)}
							className={`flex-1 rounded-[5px] py-1 text-[10px] font-medium capitalize transition-colors ${
								segment === seg
									? "bg-bg-elevated text-text-secondary"
									: "text-text-faint hover:text-text-muted"
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

			{/* Footer — Settings + Terminal icon */}
			<div className="flex items-center gap-1 border-t border-border p-2">
				<button
					type="button"
					className="flex flex-1 items-center gap-2 rounded-[6px] px-3 py-1.5 text-[13px] text-text-muted transition-all duration-[120ms] hover:bg-bg-elevated hover:text-text-secondary"
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
				<button
					type="button"
					title="Terminal"
					className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[6px] text-text-faint transition-all duration-[120ms] hover:bg-bg-elevated hover:text-text-secondary"
				>
					<svg
						aria-hidden="true"
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.5"
						strokeLinecap="round"
						strokeLinejoin="round"
					>
						<polyline points="4 17 10 11 4 5" />
						<line x1="12" y1="19" x2="20" y2="19" />
					</svg>
				</button>
			</div>
		</div>
	);
}

/* ── Repos View ─────────────────────────────────────────────────────────── */

function ReposView() {
	return (
		<>
			<div className="flex flex-col gap-2 px-2 pt-2">
				{PROJECTS.map((project, i) => {
					const isFirst = i === 0;
					const isExpanded = isFirst;
					const hasActiveBranch = project.branches.some((b) => b.active);

					return (
						<div key={project.name}>
							{/* Project group container with accent stripe when active */}
							<div
								style={
									hasActiveBranch && isExpanded
										? {
												borderLeft: "2px solid rgba(196, 149, 108, 0.19)",
												borderRadius: 2,
											}
										: undefined
								}
							>
								{/* Project header */}
								<div
									className={[
										"flex w-full items-center gap-2 px-3 py-1.5",
										"transition-all duration-[120ms] text-left",
										hasActiveBranch && isExpanded
											? "rounded-r-[8px] rounded-l-none"
											: "rounded-[8px]",
										hasActiveBranch ? "text-text-primary" : "text-[#505058]",
										hasActiveBranch && isExpanded
											? "bg-gradient-to-br from-[#1a1a24] to-[#16161e]"
											: "bg-transparent",
									].join(" ")}
								>
									{/* Project name */}
									<div className="min-w-0 flex-1">
										<div className="truncate text-[13px] font-semibold">{project.name}</div>
									</div>

									{/* + button */}
									<span
										className={[
											"flex h-5 w-5 shrink-0 items-center justify-center rounded text-[14px]",
											hasActiveBranch ? "text-text-faint" : "text-[#3a3a42]",
										].join(" ")}
									>
										+
									</span>

									{/* Chevron */}
									<svg
										aria-hidden="true"
										width="10"
										height="10"
										viewBox="0 0 10 10"
										fill="none"
										className={[
											"shrink-0 transition-transform duration-[120ms]",
											isExpanded ? "rotate-90" : "rotate-0",
											hasActiveBranch ? "text-text-faint" : "text-[#3a3a42]",
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
								</div>

								{/* Expanded branch list */}
								{isExpanded && (
									<div className="flex flex-col pt-0.5">
										{project.branches.map((branch) => (
											<div
												key={branch.name}
												className={[
													"flex w-full items-center gap-2 pr-3 py-[7px] text-left",
													"transition-all duration-[120ms]",
													branch.active
														? "rounded-r-[6px] rounded-l-none bg-[#17171e]"
														: "rounded-[6px] bg-transparent",
													branch.active && hasActiveBranch ? "pl-[20px]" : "pl-[22px]",
												].join(" ")}
												style={
													branch.active && hasActiveBranch
														? {
																borderLeft: "2px solid rgba(196, 149, 108, 0.5)",
																marginLeft: -2,
															}
														: undefined
												}
											>
												<div className="min-w-0 flex-1">
													<span
														className={[
															"truncate text-[13px] block",
															branch.active
																? "text-[#d4d4dc]"
																: hasActiveBranch
																	? "text-[#707078]"
																	: "text-[#505058]",
														].join(" ")}
													>
														{branch.name}
													</span>
													{"subtitle" in branch && branch.subtitle && (
														<span className="flex items-center gap-1 mt-0.5">
															<svg
																width="10"
																height="10"
																viewBox="0 0 16 16"
																fill="none"
																className="shrink-0"
																aria-hidden="true"
															>
																<path
																	d="M5 8l2 2 4-4"
																	stroke="#28c840"
																	strokeWidth="1.5"
																	strokeLinecap="round"
																	strokeLinejoin="round"
																/>
															</svg>
															<span className="text-[10px] text-[#3e3e46]">comments resolved</span>
														</span>
													)}
												</div>
											</div>
										))}
									</div>
								)}
							</div>
						</div>
					);
				})}
			</div>

			{/* Add Repository button */}
			<div className="px-2 py-1.5">
				<button
					type="button"
					className="flex w-full items-center gap-2 rounded-[6px] px-3 py-1.5 text-[12px] text-text-faint transition-all duration-[120ms] hover:bg-bg-elevated hover:text-text-muted"
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

/* ── Tickets View ───────────────────────────────────────────────────────── */

function TicketsView() {
	const totalCount = TICKETS.length;

	return (
		<div className="flex flex-col gap-1 px-2 py-1">
			{/* All Tickets */}
			<button
				type="button"
				className="flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-[11px] bg-[rgba(196,149,108,0.08)] font-medium text-text-primary transition-colors duration-[120ms]"
			>
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
				<span className="text-[10px] tabular-nums text-text-faint">{totalCount}</span>
			</button>

			<div className="mx-2 my-1 h-px bg-border" />

			{/* LINEAR section header */}
			<div className="px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.5px] text-text-faint">
				Linear
			</div>

			{/* Linear project item */}
			<button
				type="button"
				className="flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-[11px] text-text-secondary transition-colors duration-[120ms] hover:bg-bg-elevated"
			>
				<div className="h-[6px] w-[6px] shrink-0 rounded-full bg-text-faint" />
				<span className="flex-1 truncate">SuperiorSwarm</span>
				<span className="text-[10px] tabular-nums text-text-faint">{totalCount}</span>
			</button>
		</div>
	);
}

/* ── PRs View ───────────────────────────────────────────────────────────── */

function PrsView({
	selectedPr,
	onPrSelect,
}: {
	selectedPr: number | null;
	onPrSelect: (id: number) => void;
}) {
	return (
		<div className="flex flex-col">
			{PULL_REQUESTS.map((group) => (
				<div key={group.repo}>
					{/* Repo group header */}
					<button
						type="button"
						className="flex w-full items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.05em] text-text-faint transition-colors hover:text-text-muted"
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
						<span className="truncate">{group.repo}</span>
						<span className="ml-auto text-[10px] tabular-nums opacity-60">{group.prs.length}</span>
					</button>

					{/* PR items */}
					<div className="flex flex-col gap-0.5 px-1">
						{group.prs.map((pr) => {
							const healthColor =
								pr.status === "success"
									? "#3fb950"
									: pr.status === "pending"
										? "#d29922"
										: "#484848";

							return (
								<button
									key={pr.id}
									type="button"
									onClick={() => onPrSelect(pr.id)}
									className={`group flex w-full flex-col gap-0.5 rounded-[6px] px-2.5 py-1.5 text-left text-[12px] transition-all duration-[120ms] ${
										selectedPr === pr.id
											? "bg-bg-overlay text-text-primary"
											: "text-text-muted hover:bg-bg-elevated hover:text-text-secondary"
									}`}
									title={`${group.repo}#${pr.id}: ${pr.title}`}
								>
									{/* Row 1: Title + health dot + PR number */}
									<div className="flex items-center gap-1">
										<span className="min-w-0 flex-1 truncate text-[12px] leading-tight">
											{pr.title}
										</span>
										<span
											className="size-1.5 shrink-0 rounded-full"
											style={{ backgroundColor: healthColor }}
										/>
										<span className="shrink-0 font-mono text-[10px] text-text-faint">#{pr.id}</span>
									</div>

									{/* Row 2: Branch info */}
									<div className="flex items-center gap-1 text-[10px] text-text-faint">
										<span className="min-w-0 truncate font-mono">{pr.branch}</span>
										<span className="shrink-0">{">"}</span>
										<span className="shrink-0 truncate font-mono">{pr.target}</span>
									</div>

									{/* Row 3: Author */}
									<div className="mt-0.5 flex items-center gap-1 text-[10px] text-text-faint">
										<span className="shrink-0 text-[8px] uppercase tracking-[0.05em] opacity-50">
											by
										</span>
										<div
											className="flex size-4 shrink-0 items-center justify-center rounded-full text-[7px] font-bold text-text-muted"
											style={{ backgroundColor: "var(--color-bg-overlay)" }}
										>
											{pr.authorInitial}
										</div>
										<span className="truncate">{pr.author}</span>
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
