// PoppyTickets — 3s scene. Linear kanban board orchestrated from scratch so
// every visible piece pops on its own beat: tabs strip → "All Tickets" entry
// → Linear filters → board header → board toolbar → each column header → each
// ticket card. Mirrors apps/desktop/.../tickets/ shape via the same data
// source (TICKETS_V4) and v4 color tokens.

import type { ReactNode } from "react";
import { useColorsV4 } from "../../build-v4/colors-v4";
import { TICKETS_V4 } from "../../build-v4/data";
import { Pop } from "../Pop";

const SIDEBAR_WIDTH = 280;
const HIGHLIGHTED_ID = "SS-148";

interface Props {
	header?: ReactNode;
}

export function PoppyTickets({ header }: Props) {
	const c = useColorsV4();
	const total = TICKETS_V4.length;

	return (
		<>
			{/* Left sidebar — tab strip + All Tickets + Linear filters, each piece pops separately. */}
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
				<Pop variant="slideDown" delay={0} duration={12}>
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
				</Pop>

				<div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "4px 8px" }}>
					<Pop variant="slideRight" delay={8} duration={12}>
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
								<rect
									x="2"
									y="2"
									width="5"
									height="5"
									rx="1"
									stroke="currentColor"
									strokeWidth="1.3"
								/>
								<rect
									x="9"
									y="2"
									width="5"
									height="5"
									rx="1"
									stroke="currentColor"
									strokeWidth="1.3"
								/>
								<rect
									x="2"
									y="9"
									width="5"
									height="5"
									rx="1"
									stroke="currentColor"
									strokeWidth="1.3"
								/>
								<rect
									x="9"
									y="9"
									width="5"
									height="5"
									rx="1"
									stroke="currentColor"
									strokeWidth="1.3"
								/>
							</svg>
							<span style={{ flex: 1 }}>All Tickets</span>
							<span style={{ fontSize: 10, color: c.textQuaternary }}>{total}</span>
						</div>
					</Pop>

					<Pop variant="fadeIn" delay={20} duration={8}>
						<div style={{ height: 1, background: c.borderSubtle, margin: "4px 8px" }} />
					</Pop>
					<Pop variant="fadeIn" delay={22} duration={10}>
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
					</Pop>

					{[
						{ name: "SuperiorSwarm", count: total },
						{ name: "Platform", count: 2 },
						{ name: "Growth", count: 1 },
					].map((p, i) => (
						<Pop key={p.name} variant="slideRight" delay={28 + i * 6} duration={12}>
							<div
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
								<span style={{ fontSize: 10, color: c.textQuaternary }}>{p.count}</span>
							</div>
						</Pop>
					))}
				</div>
			</div>

			{/* Center — header bar + 3-column board, each column header and card stamps in. */}
			<div
				style={{
					flex: 1,
					background: c.bgBase,
					display: "flex",
					flexDirection: "column",
					overflow: "hidden",
				}}
			>
				{header}
				<Pop variant="slideDown" delay={14} duration={12}>
					<BoardToolbar total={total} />
				</Pop>

				<div
					style={{
						flex: 1,
						display: "flex",
						gap: 10,
						padding: "12px 14px",
						overflow: "hidden",
					}}
				>
					<BoardColumn
						label="Todo"
						color={c.textQuaternary}
						state="todo"
						baseDelay={32}
						cardStagger={10}
						highlightedId={HIGHLIGHTED_ID}
					/>
					<BoardColumn
						label="In Progress"
						color={c.accent}
						state="in-progress"
						baseDelay={56}
						cardStagger={10}
						highlightedId={null}
					/>
					<BoardColumn
						label="Done"
						color="#69db7c"
						state="done"
						baseDelay={80}
						cardStagger={10}
						highlightedId={null}
					/>
				</div>
			</div>
		</>
	);
}

function BoardToolbar({ total }: { total: number }) {
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

interface ColumnProps {
	label: string;
	color: string;
	state: "todo" | "in-progress" | "done";
	baseDelay: number;
	cardStagger: number;
	highlightedId: string | null;
}

function BoardColumn({ label, color, state, baseDelay, cardStagger, highlightedId }: ColumnProps) {
	const c = useColorsV4();
	const tickets = TICKETS_V4.filter((t) => t.state === state);

	return (
		<div
			style={{
				flex: 1,
				display: "flex",
				flexDirection: "column",
				gap: 6,
				minWidth: 0,
			}}
		>
			<Pop variant="slideDown" delay={baseDelay} duration={12}>
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
						<circle cx="8" cy="8" r="6" fill="none" stroke={color} strokeWidth="1.5" />
					</svg>
					<span>{label}</span>
					<span style={{ marginLeft: "auto", fontWeight: 400, opacity: 0.5 }}>{tickets.length}</span>
				</div>
			</Pop>

			{tickets.map((ticket, i) => (
				<Pop key={ticket.id} variant="stampPop" delay={baseDelay + 8 + i * cardStagger} duration={16}>
					<div
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
						{ticket.id === highlightedId && (
							<div
								style={{
									position: "absolute",
									inset: -2,
									borderRadius: 8,
									border: `2px solid ${c.accent}`,
									pointerEvents: "none",
								}}
							/>
						)}
						<div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10 }}>
							<svg width="8" height="8" viewBox="0 0 16 16" aria-hidden="true">
								<circle cx="8" cy="8" r="6" fill="none" stroke={color} strokeWidth="1.5" />
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
						<div style={{ fontSize: 11, color: c.text, lineHeight: 1.35 }}>{ticket.title}</div>
					</div>
				</Pop>
			))}
		</div>
	);
}
