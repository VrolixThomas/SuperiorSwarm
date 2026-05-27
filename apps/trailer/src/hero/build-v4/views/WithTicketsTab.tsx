import type { ReactNode } from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { useColorsV4 } from "../colors-v4";
import { TICKETS_V4 } from "../data";
import { SCENES_V4 } from "../timeline";

const SIDEBAR_WIDTH = 280;
const DETAIL_HEIGHT = 360;
const HIGHLIGHTED_TICKET_ID = "SS-148";
const DETAIL_FRAME = 120;

// Mirrors apps/desktop/src/renderer/components/tickets/* — left sidebar +
// kanban board on top, ticket detail panel sliding up from BOTTOM (full
// width). Inside the detail panel: body left + 200px metadata column right
// (matches real TicketDetailPanel layout).
export function WithTicketsTab({ header }: { header?: ReactNode }) {
	const c = useColorsV4();
	const frame = useCurrentFrame();
	const local = frame - SCENES_V4.s9Tickets.from;

	const detailOp = interpolate(local, [DETAIL_FRAME, DETAIL_FRAME + 18], [0, 1], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});
	const detailH = interpolate(local, [DETAIL_FRAME, DETAIL_FRAME + 24], [0, DETAIL_HEIGHT], {
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
				{header}
				<TicketsBoardHeader total={TICKETS_V4.length} />
				<div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
					<TicketsBoardInline highlightedId={HIGHLIGHTED_TICKET_ID} highlightOp={detailOp} />
				</div>
				<div
					style={{
						height: detailH,
						flexShrink: 0,
						overflow: "hidden",
						background: c.bgSurface,
						borderTop: `1px solid ${c.borderSubtle}`,
						opacity: detailOp,
					}}
				>
					<div style={{ height: DETAIL_HEIGHT }}>
						<TicketDetailPanelV4 ticketId={HIGHLIGHTED_TICKET_ID} />
					</div>
				</div>
			</div>
		</>
	);
}

function TicketsBoardHeader({ total }: { total: number }) {
	const c = useColorsV4();
	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				gap: 10,
				padding: "8px 14px",
				borderBottom: `1px solid ${c.borderSubtle}`,
				flexShrink: 0,
			}}
		>
			<span style={{ fontSize: 13, fontWeight: 600, color: c.text }}>SuperiorSwarm</span>
			<span style={{ fontSize: 11, color: c.textQuaternary }}>Linear · {total} tickets</span>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 4,
					marginLeft: 4,
					padding: "3px 8px",
					borderRadius: 4,
					background: c.bgOverlay,
					fontSize: 11,
					color: c.textSecondary,
				}}
			>
				<svg width="9" height="9" viewBox="0 0 12 12" fill="none" aria-hidden="true">
					<circle cx="6" cy="4" r="2" stroke={c.textTertiary} strokeWidth="1.2" />
					<path
						d="M2.5 10c.5-1.5 1.8-2.5 3.5-2.5s3 1 3.5 2.5"
						stroke={c.textTertiary}
						strokeWidth="1.2"
						strokeLinecap="round"
					/>
				</svg>
				Me
				<svg width="8" height="8" viewBox="0 0 12 12" fill="none" aria-hidden="true">
					<path
						d="M3 4.5l3 3 3-3"
						stroke={c.textTertiary}
						strokeWidth="1.4"
						strokeLinecap="round"
					/>
				</svg>
			</div>
			<div style={{ flex: 1 }} />
			<div style={{ display: "flex", padding: 2, borderRadius: 6, background: c.bgOverlay }}>
				{(["Board", "List", "Table"] as const).map((label, i) => (
					<div
						key={label}
						style={{
							padding: "3px 10px",
							borderRadius: 4,
							background: i === 0 ? c.bgElevated : "transparent",
							color: i === 0 ? c.textSecondary : c.textQuaternary,
							fontSize: 11,
						}}
					>
						{label}
					</div>
				))}
			</div>
		</div>
	);
}

function TicketsSidebarInline() {
	const c = useColorsV4();
	const total = TICKETS_V4.length;

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "4px 8px" }}>
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
								</div>
							);
						})}
					</div>
				);
			})}
		</div>
	);
}

// Mirrors apps/desktop/.../tickets/TicketDetailPanel.tsx structure: header
// row (status pill, identifier, provider, Open ↗ + Esc), two-column body
// (left = title + description + activity, right 200px = Status / Assignee /
// Workspaces / Provider / "Create Worktree" button).
function TicketDetailPanelV4({ ticketId }: { ticketId: string }) {
	const c = useColorsV4();
	const ticket = TICKETS_V4.find((t) => t.id === ticketId);
	if (!ticket) return null;

	const description =
		"Drag handle on the kanban column header drifts left when the sidebar is collapsed mid-drag. " +
		"Reproduces every time with the Repos pane open and the user toggling collapse during an in-flight drag. " +
		"Suspect the pointer offset is captured against the original viewport rect.";

	return (
		<div
			style={{
				display: "flex",
				height: "100%",
				flexDirection: "column",
				background: c.bgSurface,
			}}
		>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 10,
					padding: "10px 20px",
					borderBottom: `1px solid ${c.borderSubtle}`,
					flexShrink: 0,
				}}
			>
				<svg width="10" height="10" viewBox="0 0 16 16" aria-hidden="true">
					<circle cx="8" cy="8" r="6" fill="none" stroke={c.textQuaternary} strokeWidth="1.5" />
				</svg>
				<span style={{ fontSize: 13, fontWeight: 600, color: c.text }}>{ticket.id}</span>
				<span
					style={{
						padding: "2px 8px",
						borderRadius: 99,
						background: c.bgOverlay,
						color: c.textTertiary,
						fontSize: 10,
					}}
				>
					Todo
				</span>
				<span style={{ fontSize: 10, color: c.textQuaternary }}>Linear · SuperiorSwarm</span>
				<div style={{ flex: 1 }} />
				<div
					style={{
						padding: "4px 8px",
						borderRadius: 4,
						background: c.bgElevated,
						color: c.textTertiary,
						fontSize: 10,
					}}
				>
					Open in Linear ↗
				</div>
				<div
					style={{
						padding: "4px 8px",
						borderRadius: 4,
						background: c.bgElevated,
						color: c.textQuaternary,
						fontSize: 10,
					}}
				>
					Esc
				</div>
			</div>

			<div style={{ display: "flex", flex: 1, minHeight: 0 }}>
				<div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
					<div
						style={{
							fontSize: 16,
							fontWeight: 600,
							lineHeight: 1.3,
							color: c.text,
						}}
					>
						{ticket.title}
					</div>
					<p
						style={{
							marginTop: 12,
							fontSize: 12,
							lineHeight: 1.7,
							color: c.textSecondary,
							whiteSpace: "pre-wrap",
						}}
					>
						{description}
					</p>
				</div>

				<div
					style={{
						width: 200,
						flexShrink: 0,
						borderLeft: `1px solid ${c.borderSubtle}`,
						padding: 16,
						display: "flex",
						flexDirection: "column",
						gap: 16,
					}}
				>
					<DetailField label="Status">
						<div
							style={{
								padding: "6px 8px",
								borderRadius: 5,
								background: c.bgElevated,
								border: `1px solid ${c.borderSubtle}`,
								fontSize: 11,
								color: c.textSecondary,
							}}
						>
							Todo
						</div>
					</DetailField>

					<DetailField label="Assignee">
						<div
							style={{
								display: "flex",
								alignItems: "center",
								gap: 8,
								padding: "6px 8px",
								borderRadius: 5,
								background: c.bgElevated,
								border: `1px solid ${c.borderSubtle}`,
							}}
						>
							<div
								style={{
									width: 18,
									height: 18,
									borderRadius: "50%",
									background: c.accent,
									color: "#fff",
									fontSize: 9,
									fontWeight: 600,
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
								}}
							>
								S
							</div>
							<span style={{ fontSize: 11, color: c.textSecondary }}>sam</span>
						</div>
					</DetailField>

					<DetailField label="Workspaces">
						<div style={{ fontSize: 11, fontStyle: "italic", color: c.textQuaternary }}>
							None yet
						</div>
					</DetailField>

					<DetailField label="Provider">
						<div style={{ fontSize: 11, color: c.textSecondary }}>Linear · SuperiorSwarm</div>
					</DetailField>

					<div style={{ marginTop: "auto" }}>
						<div
							style={{
								padding: "8px 12px",
								borderRadius: 6,
								background: c.accent,
								color: "#fff",
								fontSize: 11,
								fontWeight: 500,
								textAlign: "center",
							}}
						>
							Create Worktree
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

function DetailField({ label, children }: { label: string; children: React.ReactNode }) {
	const c = useColorsV4();
	return (
		<div>
			<div
				style={{
					marginBottom: 6,
					fontSize: 9,
					fontWeight: 600,
					letterSpacing: "0.3px",
					textTransform: "uppercase",
					color: c.textQuaternary,
				}}
			>
				{label}
			</div>
			{children}
		</div>
	);
}
