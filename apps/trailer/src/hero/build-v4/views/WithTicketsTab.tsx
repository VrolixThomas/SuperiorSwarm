import { interpolate, useCurrentFrame } from "remotion";
import { useColorsV4 } from "../colors-v4";
import { TICKETS_V4 } from "../data";
import { SCENES_V4 } from "../timeline";

const SIDEBAR_WIDTH = 280;
const HIGHLIGHTED_TICKET_ID = "SS-148";
const HIGHLIGHT_FRAME = 120;

// Mirrors apps/desktop/src/renderer/components/tickets/TicketsSidebar.tsx +
// TicketsBoardView.tsx layout. Static — no terminal swap in this scene; the
// "Start worktree" affordance is just visual (real app switches to Repos +
// opens a worktree view, which is shown elsewhere in the trailer).
export function WithTicketsTab() {
	const c = useColorsV4();
	const frame = useCurrentFrame();
	const local = frame - SCENES_V4.s9Tickets.from;

	const highlightOp = interpolate(local, [HIGHLIGHT_FRAME, HIGHLIGHT_FRAME + 18], [0, 1], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});

	return (
		<>
			<div
				style={{
					width: SIDEBAR_WIDTH,
					flexShrink: 0,
					background: c.bgSurface,
					borderRight: `1px solid ${c.borderSubtle}`,
					display: "flex",
					flexDirection: "column",
				}}
			>
				{/* Tab strip — Tickets active */}
				<div
					style={{
						display: "flex",
						padding: "6px 8px",
						gap: 4,
						borderBottom: `1px solid ${c.borderSubtle}`,
					}}
				>
					{(["Repos", "Tickets", "PRs"] as const).map((label, i) => (
						<div
							key={label}
							style={{
								flex: 1,
								padding: "5px 0",
								textAlign: "center",
								fontSize: 10,
								fontWeight: 500,
								borderRadius: 5,
								background: i === 1 ? c.bgElevated : "transparent",
								color: i === 1 ? c.textSecondary : c.textQuaternary,
							}}
						>
							{label}
						</div>
					))}
				</div>

				<TicketsSidebarInline />
			</div>

			<div
				style={{
					flex: 1,
					background: c.bgBase,
					display: "flex",
					flexDirection: "column",
					overflow: "hidden",
					position: "relative",
				}}
			>
				<TicketsBoardInline highlightedId={HIGHLIGHTED_TICKET_ID} highlightOp={highlightOp} />
			</div>
		</>
	);
}

function TicketsSidebarInline() {
	const c = useColorsV4();
	const total = TICKETS_V4.length;

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "4px 8px" }}>
			{/* All Tickets */}
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 8,
					padding: "6px 8px",
					borderRadius: 6,
					background: "rgba(10,132,255,0.08)",
					color: c.text,
					fontSize: 11,
					fontWeight: 500,
				}}
			>
				<svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
					<rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" />
					<rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" />
					<rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" />
					<rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" />
				</svg>
				<span style={{ flex: 1 }}>All Tickets</span>
				<span style={{ fontSize: 10, color: c.textQuaternary, fontVariantNumeric: "tabular-nums" }}>
					{total}
				</span>
			</div>

			<div style={{ height: 1, background: c.borderSubtle, margin: "4px 8px" }} />

			{/* Linear section */}
			<div
				style={{
					padding: "4px 8px",
					fontSize: 9,
					fontWeight: 600,
					letterSpacing: "0.5px",
					textTransform: "uppercase",
					color: c.textQuaternary,
				}}
			>
				Linear
			</div>

			{[
				{ name: "SuperiorSwarm", count: total },
				{ name: "Platform", count: 2 },
				{ name: "Growth", count: 1 },
			].map((p) => (
				<div
					key={p.name}
					style={{
						display: "flex",
						alignItems: "center",
						gap: 8,
						padding: "6px 8px",
						borderRadius: 6,
						color: c.textSecondary,
						fontSize: 11,
					}}
				>
					<div
						style={{
							width: 6,
							height: 6,
							borderRadius: "50%",
							background: c.textQuaternary,
							flexShrink: 0,
						}}
					/>
					<span style={{ flex: 1 }}>{p.name}</span>
					<span
						style={{ fontSize: 10, color: c.textQuaternary, fontVariantNumeric: "tabular-nums" }}
					>
						{p.count}
					</span>
				</div>
			))}
		</div>
	);
}

function TicketsBoardInline({
	highlightedId,
	highlightOp,
}: {
	highlightedId: string;
	highlightOp: number;
}) {
	const c = useColorsV4();

	const columns: Array<{ key: string; label: string; color: string }> = [
		{ key: "todo", label: "Todo", color: c.textQuaternary },
		{ key: "in-progress", label: "In Progress", color: c.accent },
		{ key: "done", label: "Done", color: "#69db7c" },
	];

	return (
		<div
			style={{
				flex: 1,
				display: "flex",
				gap: 10,
				padding: "12px 14px",
				overflow: "hidden",
			}}
		>
			{columns.map((col) => {
				const tickets = TICKETS_V4.filter((t) => t.state === col.key);
				return (
					<div
						key={col.key}
						style={{
							flex: 1,
							display: "flex",
							flexDirection: "column",
							gap: 6,
							minWidth: 0,
						}}
					>
						<div
							style={{
								display: "flex",
								alignItems: "center",
								gap: 6,
								padding: "4px 4px",
								fontSize: 9,
								fontWeight: 600,
								letterSpacing: "0.3px",
								textTransform: "uppercase",
								color: c.textTertiary,
							}}
						>
							<svg width="8" height="8" viewBox="0 0 16 16" aria-hidden="true">
								<circle cx="8" cy="8" r="6" fill="none" stroke={col.color} strokeWidth="1.5" />
							</svg>
							<span>{col.label}</span>
							<span
								style={{
									marginLeft: "auto",
									fontWeight: 400,
									opacity: 0.5,
									fontVariantNumeric: "tabular-nums",
								}}
							>
								{tickets.length}
							</span>
						</div>

						{tickets.map((ticket) => {
							const isHighlighted = ticket.id === highlightedId;
							return (
								<div
									key={ticket.id}
									style={{
										position: "relative",
										background: c.bgSurface,
										border: `1px solid ${c.borderSubtle}`,
										borderRadius: 6,
										padding: "8px 10px",
										display: "flex",
										flexDirection: "column",
										gap: 4,
									}}
								>
									{isHighlighted && highlightOp > 0 && (
										<div
											style={{
												position: "absolute",
												inset: -2,
												borderRadius: 8,
												border: `2px solid ${c.accent}`,
												opacity: highlightOp,
												pointerEvents: "none",
											}}
										/>
									)}
									<div
										style={{
											display: "flex",
											alignItems: "center",
											gap: 6,
											fontSize: 10,
										}}
									>
										<svg width="8" height="8" viewBox="0 0 16 16" aria-hidden="true">
											<circle
												cx="8"
												cy="8"
												r="6"
												fill="none"
												stroke={col.color}
												strokeWidth="1.5"
											/>
										</svg>
										<span
											style={{
												fontFamily: "monospace",
												fontWeight: 600,
												color: c.textQuaternary,
											}}
										>
											{ticket.id}
										</span>
										<span style={{ color: c.textQuaternary, opacity: 0.6 }}>Linear</span>
									</div>
									<div
										style={{
											fontSize: 11,
											color: c.text,
											lineHeight: 1.35,
										}}
									>
										{ticket.title}
									</div>
									{isHighlighted && highlightOp > 0 && (
										<div
											style={{
												opacity: highlightOp,
												marginTop: 4,
												display: "flex",
												alignItems: "center",
												gap: 6,
												padding: "5px 8px",
												borderRadius: 5,
												background: "rgba(10,132,255,0.12)",
												color: c.accent,
												fontSize: 10,
												fontWeight: 500,
												width: "fit-content",
											}}
										>
											<svg
												width="11"
												height="11"
												viewBox="0 0 16 16"
												fill="none"
												stroke="currentColor"
												strokeWidth="1.6"
												strokeLinecap="round"
												aria-hidden="true"
											>
												<path d="M8 3v10M3 8h10" />
											</svg>
											Start worktree
										</div>
									)}
								</div>
							);
						})}
					</div>
				);
			})}
		</div>
	);
}
