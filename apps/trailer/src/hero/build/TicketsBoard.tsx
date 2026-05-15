import { interpolate, useCurrentFrame } from "remotion";
import { C } from "./colors";
import { INTER } from "./fonts";
import { useEntry } from "./useEntry";

interface Column {
	id: string;
	label: string;
	stateColor: string;
	count: number;
	tickets: { id: string; title: string; provider: string }[];
}

const COLUMNS: Column[] = [
	{
		id: "backlog",
		label: "BACKLOG",
		stateColor: C.textQuaternary,
		count: 0,
		tickets: [],
	},
	{
		id: "todo",
		label: "TODO",
		stateColor: C.textSecondary,
		count: 2,
		tickets: [
			{ id: "SUP-214", title: "Register custom MCP server presets", provider: "Linear" },
			{ id: "SUP-219", title: "Create worktree from PR review thread", provider: "Linear" },
		],
	},
	{
		id: "inprogress",
		label: "IN PROGRESS",
		stateColor: C.accent,
		count: 1,
		tickets: [{ id: "SUP-221", title: "Persist agent terminal scrollback", provider: "Linear" }],
	},
	{
		id: "done",
		label: "DONE",
		stateColor: C.success,
		count: 2,
		tickets: [
			{ id: "SUP-224", title: "Resolve GitHub comments into separate commits", provider: "Linear" },
			{ id: "SUP-229", title: "Sync Linear status from merged branch", provider: "Linear" },
		],
	},
];

interface Props {
	entryFrame: number;
}

export function TicketsBoard({ entryFrame }: Props) {
	const frame = useCurrentFrame();
	const headerEntry = useEntry({ from: entryFrame, dy: -10 });
	const toolbarEntry = useEntry({ from: entryFrame + 8, dy: -6 });

	return (
		<div
			style={{
				flex: 1,
				display: "flex",
				flexDirection: "column",
				padding: "14px 18px",
				fontFamily: INTER,
				color: C.text,
				overflow: "hidden",
			}}
		>
			<div style={{ display: "flex", alignItems: "center", gap: 10, ...headerEntry }}>
				<div style={{ fontSize: 17, fontWeight: 700 }}>All Tickets</div>
				<div style={{ fontSize: 11, color: C.textQuaternary }}>
					All providers · 5 tickets · Updated 11h ago
				</div>
				<div style={{ flex: 1 }} />
			</div>
			<div
				style={{
					marginTop: 12,
					height: 32,
					display: "flex",
					alignItems: "center",
					gap: 10,
					...toolbarEntry,
				}}
			>
				<div
					style={{
						display: "flex",
						background: C.bgSurface,
						padding: 2,
						borderRadius: 6,
					}}
				>
					{["Board", "List", "Table"].map((label, i) => (
						<div
							key={label}
							style={{
								padding: "3px 10px",
								borderRadius: 4,
								background: i === 0 ? C.bgElevated : "transparent",
								color: i === 0 ? C.textSecondary : C.textQuaternary,
								fontSize: 10,
								fontWeight: 500,
							}}
						>
							{label}
						</div>
					))}
				</div>
				<div style={{ flex: 1 }} />
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: 6,
						padding: "4px 8px",
						borderRadius: 999,
						background: C.bgElevated,
						border: `1px solid ${C.borderSubtle}`,
						fontSize: 10,
						color: C.textTertiary,
					}}
				>
					<span
						style={{
							width: 12,
							height: 12,
							borderRadius: "50%",
							background: C.accent,
							display: "inline-flex",
							alignItems: "center",
							justifyContent: "center",
							fontSize: 7,
							fontWeight: 700,
							color: C.accentFg,
							letterSpacing: 0,
						}}
					>
						T
					</span>
					<span>Assignee: me</span>
				</div>
			</div>
			<div
				style={{
					marginTop: 12,
					display: "grid",
					gridTemplateColumns: "repeat(4, 1fr)",
					gap: 12,
					flex: 1,
					minHeight: 0,
				}}
			>
				{COLUMNS.map((col, ci) => {
					const colDelay = entryFrame + 18 + ci * 14;
					const colOp = interpolate(frame, [colDelay, colDelay + 14], [0, 1], {
						extrapolateLeft: "clamp",
						extrapolateRight: "clamp",
					});
					const colY = interpolate(frame, [colDelay, colDelay + 14], [12, 0], {
						extrapolateLeft: "clamp",
						extrapolateRight: "clamp",
					});
					return (
						<div
							key={col.id}
							style={{
								opacity: colOp,
								transform: `translateY(${colY}px)`,
								display: "flex",
								flexDirection: "column",
								gap: 8,
								minWidth: 0,
							}}
						>
							<div style={{ display: "flex", alignItems: "center", gap: 6 }}>
								<span
									style={{
										width: 10,
										height: 10,
										borderRadius: "50%",
										border: `1.5px solid ${col.stateColor}`,
										background: col.id === "inprogress" ? col.stateColor : "transparent",
										boxShadow: col.id === "done" ? `0 0 6px ${col.stateColor}` : undefined,
									}}
								/>
								<span
									style={{
										fontSize: 10,
										fontWeight: 700,
										letterSpacing: 1.2,
										color: col.stateColor,
									}}
								>
									{col.label}
								</span>
								<span style={{ flex: 1 }} />
								<span style={{ fontSize: 11, color: C.textQuaternary }}>{col.count}</span>
							</div>
							<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
								{col.tickets.map((t, ti) => {
									const tStart = colDelay + 8 + ti * 8;
									const tOp = interpolate(frame, [tStart, tStart + 12], [0, 1], {
										extrapolateLeft: "clamp",
										extrapolateRight: "clamp",
									});
									const tY = interpolate(frame, [tStart, tStart + 12], [8, 0], {
										extrapolateLeft: "clamp",
										extrapolateRight: "clamp",
									});
									return (
										<div
											key={t.id}
											style={{
												opacity: tOp,
												transform: `translateY(${tY}px)`,
												padding: "10px 12px",
												borderRadius: 6,
												background: C.bgSurface,
												border: `1px solid ${C.borderSubtle}`,
											}}
										>
											<div style={{ display: "flex", alignItems: "center", gap: 6 }}>
												<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
													<circle
														cx="5"
														cy="5"
														r="4"
														stroke={col.stateColor}
														strokeWidth="1.5"
														fill={col.id === "inprogress" ? col.stateColor : "transparent"}
														fillOpacity={col.id === "inprogress" ? 1 : 0}
													/>
												</svg>
												<span style={{ fontSize: 10, fontWeight: 700, color: C.text }}>
													{t.id}
												</span>
												<span style={{ fontSize: 9, color: C.textQuaternary }}>{t.provider}</span>
											</div>
											<div
												style={{
													marginTop: 6,
													fontSize: 12,
													color: C.text,
													lineHeight: 1.35,
												}}
											>
												{t.title}
											</div>
										</div>
									);
								})}
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}
