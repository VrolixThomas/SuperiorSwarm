import { interpolate, useCurrentFrame } from "remotion";
import type { TerminalLine } from "../../build/TerminalBody";
import { TerminalBody } from "../../build/TerminalBody";
import { useColorsV4 } from "../colors-v4";
import { TICKETS_V4 } from "../data";
import { SCENES_V4 } from "../timeline";

const SIDEBAR_WIDTH = 280;

const CLICKED_TICKET_ID = "SS-148";
const CLICK_FRAME = 90;

const WORKTREE_BOOT: TerminalLine[] = [
	{ t: "> Creating worktree for SS-148...", from: 0, c: "#8e8e93" },
	{ t: "git worktree add ../SS-148 -b feature/ticket-drag", from: 24 },
	{ t: "✓ worktree created", from: 60, c: "#69db7c", bold: true },
	{ t: "Starting agent in SS-148 worktree...", from: 80, c: "#8e8e93" },
	{ t: "Agent: Reading tickets/SS-148.md...", from: 110 },
	{ t: "Agent: Starting work on drag handle drift fix.", from: 140 },
	{ t: ">", from: 170, c: "#8e8e93", bold: true },
];

const STATE_LABELS: Record<string, string> = {
	todo: "Todo",
	"in-progress": "In Progress",
	done: "Done",
};

export function WithTicketsTab() {
	const c = useColorsV4();
	const frame = useCurrentFrame();
	const local = frame - SCENES_V4.s9Tickets.from;

	const showTerminal = local >= CLICK_FRAME;
	const terminalOp = interpolate(local, [CLICK_FRAME, CLICK_FRAME + 24], [0, 1], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});

	return (
		<>
			{/* Left: real Sidebar with Tickets tab active */}
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
				{/* Tab strip */}
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

				{/* Ticket list */}
				<div
					style={{
						flex: 1,
						overflow: "hidden",
						padding: "6px 0",
					}}
				>
					{TICKETS_V4.map((ticket) => {
						const isActive = ticket.id === CLICKED_TICKET_ID;
						const stateColor =
							ticket.state === "done"
								? c.success
								: ticket.state === "in-progress"
									? c.accent
									: c.textQuaternary;
						return (
							<div
								key={ticket.id}
								style={{
									padding: "6px 12px",
									background: isActive ? c.bgActive : "transparent",
									borderLeft: isActive ? `2px solid ${c.accent}` : "2px solid transparent",
									display: "flex",
									flexDirection: "column",
									gap: 3,
								}}
							>
								<div
									style={{
										display: "flex",
										alignItems: "center",
										justifyContent: "space-between",
										gap: 6,
									}}
								>
									<span
										style={{
											fontSize: 10,
											fontWeight: 700,
											fontFamily: "monospace",
											color: isActive ? c.accent : c.textQuaternary,
										}}
									>
										{ticket.id}
									</span>
									<span
										style={{
											fontSize: 9,
											fontWeight: 600,
											color: stateColor,
											background: `${stateColor}22`,
											borderRadius: 3,
											padding: "1px 5px",
											letterSpacing: "0.04em",
										}}
									>
										{STATE_LABELS[ticket.state] ?? ticket.state}
									</span>
								</div>
								<div
									style={{
										fontSize: 12,
										color: isActive ? c.text : c.textSecondary,
										fontWeight: isActive ? 600 : 400,
										lineHeight: 1.4,
									}}
								>
									{ticket.title}
								</div>
							</div>
						);
					})}
				</div>
			</div>

			{/* Right: board or terminal */}
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
				{!showTerminal ? (
					/* Tickets kanban board (inline fallback) */
					<TicketsBoardInline />
				) : (
					/* Worktree boot terminal */
					<div
						style={{
							flex: 1,
							display: "flex",
							flexDirection: "column",
							opacity: terminalOp,
						}}
					>
						{/* Terminal header */}
						<div
							style={{
								padding: "8px 14px",
								borderBottom: `1px solid ${c.borderSubtle}`,
								fontSize: 11,
								fontWeight: 600,
								color: c.textTertiary,
								flexShrink: 0,
								fontFamily: "monospace",
							}}
						>
							Terminal — SS-148
						</div>
						<div
							style={{
								flex: 1,
								background: "#0a0a0a",
								display: "flex",
								flexDirection: "column",
								overflow: "hidden",
							}}
						>
							<TerminalBody
								startFrame={SCENES_V4.s9Tickets.from + CLICK_FRAME}
								lines={WORKTREE_BOOT}
							/>
						</div>
					</div>
				)}
			</div>
		</>
	);
}

function TicketsBoardInline() {
	const c = useColorsV4();

	const columns: Array<{ key: string; label: string; color: string }> = [
		{ key: "todo", label: "Todo", color: c.textQuaternary },
		{ key: "in-progress", label: "In Progress", color: c.accent },
		{ key: "done", label: "Done", color: c.success },
	];

	return (
		<div
			style={{
				flex: 1,
				display: "flex",
				gap: 12,
				padding: 16,
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
							gap: 8,
							minWidth: 0,
						}}
					>
						{/* Column header — matches real TicketsBoardView style */}
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

						{/* Cards */}
						{tickets.map((ticket) => {
							const isActive = ticket.id === CLICKED_TICKET_ID;
							return (
								<div
									key={ticket.id}
									style={{
										background: isActive ? c.bgElevated : c.bgSurface,
										border: isActive ? `1px solid ${c.accent}` : `1px solid ${c.borderSubtle}`,
										borderRadius: 6,
										padding: "8px 10px",
										display: "flex",
										flexDirection: "column",
										gap: 3,
									}}
								>
									<div
										style={{
											fontSize: 10,
											fontFamily: "monospace",
											fontWeight: 700,
											color: isActive ? c.accent : c.textQuaternary,
										}}
									>
										{ticket.id}
									</div>
									<div
										style={{
											fontSize: 12,
											color: isActive ? c.text : c.textSecondary,
											fontWeight: isActive ? 600 : 400,
											lineHeight: 1.4,
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
